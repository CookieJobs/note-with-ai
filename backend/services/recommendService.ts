import { Note } from '../models/Note';
import { getCachedQwenEmbedding } from '../utils/embedding';
import { vectorStore } from './vectorStore';
import { rerankRecommendedNotes } from './deepseek';

export interface RecommendationOptions {
  recallK?: number;
  finalK?: number;
  s1Threshold?: number;
  hardThreshold?: number;
}

export interface RecommendationResult {
  recommendations: Array<{
    note: {
      _id: string;
      title: string;
      summary: string;
      contentText: string;
      updatedAt: Date;
    };
    score: number;
    s1: number;
    s2: number;
    type: string;
    reason: string;
  }>;
  meta: {
    recallQueries: number;
    poolSize: number;
    finalInput: number;
    finalOutput: number;
    cacheHits: number;
    cacheMisses: number;
    algoVersion: string;
    timingsMs: Record<string, number>;
  };
}

/**
 * 核心推荐服务：计算并更新笔记的关联推荐
 * - 包含多路召回、DeepSeek 重排、缓存复用、结果落库
 */
export async function updateNoteRecommendations(
  noteId: string,
  userId: string,
  options: RecommendationOptions = {}
): Promise<RecommendationResult | null> {
  const {
    recallK = 30,
    finalK = 10,
    s1Threshold = 0.50, // 收紧第一阶段向量召回阈值（从 0.35 -> 0.50）
    hardThreshold = 0.75, // 收紧最终融合得分阈值（从 0.62 -> 0.75）
  } = options;

  const t0 = Date.now();
  const ALGO_VERSION = 'semantic-notes-v3';

  // 1. 获取当前笔记
  const tNote0 = Date.now();
  const currentNote = await Note.findOne({ _id: noteId, userId });
  if (!currentNote) return null;

  const currentText = String((currentNote as any).contentText || (currentNote as any).content || '').trim();
  const currentTitle = String((currentNote as any).title || '').trim();
  const currentSummaryDb = String((currentNote as any).summary || '').trim();
  const currentUpdatedAt = (currentNote as any).updatedAt;
  const tNoteMs = Date.now() - tNote0;

  // 2. 构造查询向量
  // ⚡ 性能关键：只使用 DB 已有字段；没有就跳过该路召回
  const q0 = `${currentTitle} ${currentText}`.trim();
  const conceptsDb: string[] = Array.isArray((currentNote as any).concepts) ? (currentNote as any).concepts : [];
  const q2 = conceptsDb.length ? conceptsDb.join(' ') : '';

  // 优先复用当前笔记 embedding 作为主查询向量
  const q0Embedding: number[] =
    Array.isArray((currentNote as any).embedding) && (currentNote as any).embedding.length > 0
      ? (currentNote as any).embedding
      : [];

  const queryItems: Array<{ text: string; embedding?: number[] }> = [
    q0 ? { text: q0, embedding: q0Embedding.length ? q0Embedding : undefined } : null,
    currentSummaryDb ? { text: currentSummaryDb } : null,
    q2 ? { text: q2 } : null,
  ].filter(Boolean) as any;

  if (queryItems.length === 0) return null;

  // 3. 候选池召回（仅取 embedding）
  const tDb0 = Date.now();
  const userNotes = await Note.find({
    userId,
    _id: { $ne: noteId },
    'embedding.0': { $exists: true },
  })
    .select('_id updatedAt embedding')
    .lean();

  if (!Array.isArray(userNotes) || userNotes.length === 0) return null;

  // 并行获取各路 query embedding
  const tEmb0 = Date.now();
  const queryEmbeddings = await Promise.all(
    queryItems.map(async (q) => {
      if (Array.isArray(q.embedding) && q.embedding.length > 0) return q.embedding;
      const qt = String(q.text || '').trim();
      const emb = await getCachedQwenEmbedding(qt, 1024);
      return Array.isArray(emb) ? emb : [];
    })
  );
  const tDbMs = Date.now() - tDb0;
  const tEmbMs = Date.now() - tEmb0;

  // 4. 多路召回计算
  const merged = new Map<string, { id: string; updatedAt: string | Date | undefined; s1max: number; s1q: number[] }>();

  for (let qi = 0; qi < queryItems.length; qi++) {
    const emb = queryEmbeddings[qi];
    if (!Array.isArray(emb) || emb.length === 0) continue;
    const hits = vectorStore.searchInMemory(emb as any, userNotes as any, Math.max(1, Math.min(100, Number(recallK))), Number(s1Threshold));
    for (const h of hits) {
      const n = h.item as unknown as { _id: string; updatedAt: string | Date | undefined };
      const id = String(n._id);
      const prev = merged.get(id);
      if (!prev) {
        const arr = new Array(queryItems.length).fill(0);
        arr[qi] = h.score;
        merged.set(id, { id, updatedAt: n.updatedAt, s1max: h.score, s1q: arr });
      } else {
        prev.s1max = Math.max(prev.s1max, h.score);
        prev.s1q[qi] = Math.max(prev.s1q[qi], h.score);
      }
    }
  }

  const tRecall0 = Date.now();
  const pool = Array.from(merged.values()).sort((a, b) => b.s1max - a.s1max);
  const topRaw = pool.slice(0, Math.max(1, Math.min(50, Number(finalK))));
  const tRecallMs = Date.now() - tRecall0;

  if (topRaw.length === 0) return null;

  // 5. 二次查询：获取 TopK 详情
  const tTopDb0 = Date.now();
  const topIds = topRaw.map((x) => x.id);
  const topNotes = await Note.find({ userId, _id: { $in: topIds } })
    .select('_id title summary content contentText updatedAt')
    .lean();
  const tTopDbMs = Date.now() - tTopDb0;

  const topNoteById = new Map<string, Record<string, unknown>>(topNotes.map((n: unknown) => [String((n as Record<string, unknown>)._id), n as Record<string, unknown>]));
  const topForLLM = topRaw
    .map((x) => ({ ...x, note: topNoteById.get(x.id) }))
    .filter((x) => x.note);

  if (topForLLM.length === 0) return null;

  // 6. 准备 LLM 输入 & 缓存检查
  const candidates = topForLLM.map((x) => {
    const n = x.note as Record<string, unknown> | undefined;
    const title = String(n.title || '').trim();
    const summary = String(n.summary || '').trim();
    const contentText = String(n.contentText || n.content || '').trim();
    const excerpt = (summary || contentText).slice(0, 260);
    return { id: String(n._id), title, summary, excerpt };
  });

  const currentForLLM = {
    id: String((currentNote as any)._id),
    title: currentTitle,
    summary: currentSummaryDb,
    content: currentText.slice(0, 600),
  };

  const cache = (currentNote as any).recommendCache;
  const cacheOk = cache && cache.algoVersion === ALGO_VERSION && String(cache.sourceUpdatedAt) === String(currentUpdatedAt);
  const cacheById: Record<string, unknown> = cacheOk && cache.byCandidateId && typeof cache.byCandidateId === 'object' ? cache.byCandidateId : {};

  const missing: Array<{ id: string; title: string; summary: string; excerpt: string }> = [];
  const rrMap = new Map<string, { id: string; s2: number; type: string; reason: string }>();
  let cacheHits = 0;

  for (const c of candidates) {
    const cached = cacheById?.[c.id];
    const candUpdatedAt = String((topForLLM.find((x: { note?: Record<string, unknown> }) => String(x.note?._id) === c.id)?.note)?.updatedAt || '');
    const cachedCandUpdatedAt = String(cached?.candidateUpdatedAt || '');
    
    // 缓存命中条件：候选笔记未更新
    if (cached && cachedCandUpdatedAt && candUpdatedAt && cachedCandUpdatedAt === candUpdatedAt) {
      rrMap.set(c.id, {
        id: c.id,
        s2: Number.isFinite(Number(cached.s2)) ? Number(cached.s2) : 0,
        type: typeof cached.type === 'string' ? cached.type : '弱关联',
        reason: typeof cached.reason === 'string' ? cached.reason : '',
      });
      cacheHits++;
    } else {
      missing.push(c);
    }
  }

  // 7. LLM 重排（仅针对未命中的候选）
  const tRerank0 = Date.now();
  if (missing.length > 0) {
    const rr = await rerankRecommendedNotes({ current: currentForLLM, candidates: missing });
    for (const r of rr) rrMap.set(r.id, r);
  }
  const tRerankMs = Date.now() - tRerank0;

  // 8. 融合分数与排序
  const out = topForLLM
    .map((x) => {
      const id = String((x as any).note._id);
      const r = rrMap.get(id);
      const s2 = r?.s2 ?? 0;
      const s = 0.3 * x.s1max + 0.7 * s2;
      return {
        note: {
          _id: id,
          title: String((x as any).note.title || '').trim(),
          summary: String((x as any).note.summary || '').trim(),
          contentText: String((x as any).note.contentText || (x as any).note.content || '').trim(),
          updatedAt: (x as any).note.updatedAt,
        },
        score: s,
        s1: x.s1max,
        s2,
        type: r?.type || '弱关联',
        reason: r?.reason || '',
      };
    })
    .filter((x) => x.score >= Number(hardThreshold))
    .sort((a, b) => b.score - a.score);

  // 9. 结果写入数据库（更新 recommendCache）
  const byCandidateId: Record<string, unknown> = cacheOk && cacheById ? { ...cacheById } : {};
  for (const x of topForLLM) {
    const id = String((x as any).note._id);
    const r = rrMap.get(id);
    if (!r) continue;
    byCandidateId[id] = {
      s1: x.s1max, // 缓存第一阶段向量召回最高得分
      s2: r.s2,
      type: r.type,
      reason: r.reason,
      candidateUpdatedAt: String(((x as any).note as any).updatedAt || ''),
      cachedAt: new Date().toISOString(),
    };
  }

  await Note.updateOne(
    { _id: noteId, userId, updatedAt: currentUpdatedAt },
    {
      $set: {
        recommendCache: {
          algoVersion: ALGO_VERSION,
          sourceUpdatedAt: currentUpdatedAt,
          generatedAt: new Date().toISOString(),
          params: { recallK, finalK, s1Threshold, hardThreshold },
          byCandidateId,
        },
      },
    }
  );

  return {
    recommendations: out,
    meta: {
      recallQueries: queryItems.length,
      poolSize: pool.length,
      finalInput: topForLLM.length,
      finalOutput: out.length,
      cacheHits,
      cacheMisses: missing.length,
      algoVersion: ALGO_VERSION,
      timingsMs: {
        total: Date.now() - t0,
        currentNote: tNoteMs,
        dbEmbeddings: tDbMs,
        queryEmbeddings: tEmbMs,
        recall: tRecallMs,
        dbTopNotes: tTopDbMs,
        rerank: tRerankMs,
      },
    },
  };
}

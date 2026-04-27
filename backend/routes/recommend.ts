/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/routes/recommend.ts
import express, { Request, Response } from 'express';
import { Note } from '../models/Note';
import { searchArticlesByKeyword } from '../services/search';
import { authenticateToken } from '../middleware/auth';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { getCachedQwenEmbedding } from '../utils/embedding';
import { vectorStore } from '../services/vectorStore';
import { rerankRecommendedNotes } from '../services/deepseek';
import { logger } from '../utils/logger';

const router = express.Router();

router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  // 获取当前用户，确保只查询自己的笔记
  const user = await UserValidator.authenticateUser(req);
  const notes = await Note.find({ userId: user._id });
  const keywordCounts: Record<string, number> = {};

  for (const note of notes) {
    for (const keyword of note.keywords || []) {
      keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
    }
  }

  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  // 根据 topKeywords 调用爬虫/搜索服务
  const articles = await searchArticlesByKeyword(topKeywords);

  return ResponseHandler.success(res, { keywords: topKeywords, articles });
}));

/**
 * 语义联想笔记（方案B：多路召回→去重→仅Top10进LLM→阈值输出）
 * POST /api/recommend/semantic-notes
 * body: { noteId, recallK?:30, finalK?:10, s1Threshold?:0.35, hardThreshold?:0.62 }
 */
router.post('/semantic-notes', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  const {
    noteId,
    recallK = 30,
    finalK = 10,
    s1Threshold = 0.50, // 收紧阈值
    hardThreshold = 0.75, // 收紧阈值
  } = req.body || {};

  const t0 = Date.now();

  if (!noteId || typeof noteId !== 'string') {
    throw ErrorHandler.createValidationError('noteId 不能为空');
  }

  const tNote0 = Date.now();
  const currentNote = await ResourceValidator.validateOwnership(Note, noteId, user._id.toString(), '笔记');
  const currentText = String((currentNote as any).contentText || (currentNote as any).content || '').trim();
  const currentTitle = String((currentNote as any).title || '').trim();
  const currentSummaryDb = String((currentNote as any).summary || '').trim();
  const currentUpdatedAt = (currentNote as any).updatedAt;
  const tNoteMs = Date.now() - tNote0;

  const ALGO_VERSION = 'semantic-notes-v3';

  // ⚡ 性能关键：联想接口里不再“现场调用 LLM 生成 summary / concepts”
  // - summary / concepts 应由保存流程或批处理生成并落库（节省 token + 降低联想延迟）
  // - 联想时只使用 DB 已有字段；没有就跳过该路召回
  const q0 = `${currentTitle} ${currentText}`.trim();
  const conceptsDb: string[] = Array.isArray((currentNote as any).concepts) ? (currentNote as any).concepts : [];
  const q2 = conceptsDb.length ? conceptsDb.join(' ') : '';

  // 优先复用当前笔记 embedding 作为主查询向量（若存在，避免外部 embedding API）
  const q0Embedding: number[] =
    Array.isArray((currentNote as any).embedding) && (currentNote as any).embedding.length > 0
      ? (currentNote as any).embedding
      : [];

  const queryItems: Array<{ text: string; embedding?: number[] }> = [
    q0 ? { text: q0, embedding: q0Embedding.length ? q0Embedding : undefined } : null,
    currentSummaryDb ? { text: currentSummaryDb } : null,
    q2 ? { text: q2 } : null,
  ].filter(Boolean) as any;

  if (queryItems.length === 0) {
    ResponseHandler.success(res, { recommendations: [], meta: { recall: 0, final: 0 } }, '无可用查询文本');
    return;
  }

  // 候选池（瘦身版）：先只取 embedding（避免把 content/contentText 大字段全量拉回来）
  const tDb0 = Date.now();
  const userNotesPromise = Note.find({
    userId: user._id,
    _id: { $ne: noteId },
    'embedding.0': { $exists: true },
  })
    .select('_id updatedAt embedding')
    .lean();

  // 多路召回：每一路 TopK=recallK，合并去重，取每条的 s1max
  const merged = new Map<string, { id: string; updatedAt: string | Date | undefined; s1max: number; s1q: number[] }>();

  // 并行获取各路 query embedding（有内置 embedding 的直接复用）
  const tEmb0 = Date.now();
  const queryEmbeddingsPromise = Promise.all(
    queryItems.map(async (q) => {
      if (Array.isArray(q.embedding) && q.embedding.length > 0) return q.embedding;
      const qt = String(q.text || '').trim();
      const emb = await getCachedQwenEmbedding(qt, 1024);
      return Array.isArray(emb) ? emb : [];
    })
  );

  const [userNotes, queryEmbeddings] = await Promise.all([userNotesPromise, queryEmbeddingsPromise]);
  const tDbMs = Date.now() - tDb0;
  const tEmbMs = Date.now() - tEmb0;

  if (!Array.isArray(userNotes) || userNotes.length === 0) {
    ResponseHandler.success(res, { recommendations: [], meta: { recall: 0, final: 0 } }, '没有可用于联想的向量笔记');
    return;
  }

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

  if (topRaw.length === 0) {
    ResponseHandler.success(res, { recommendations: [], meta: { recall: 0, final: 0 } }, '无满足阈值的候选');
    return;
  }

  // 二次查询：只取 topK 详情（title/summary/contentText...）
  const tTopDb0 = Date.now();
  const topIds = topRaw.map((x) => x.id);
  const topNotes = await Note.find({ userId: user._id, _id: { $in: topIds } })
    .select('_id title summary content contentText updatedAt')
    .lean();
  const tTopDbMs = Date.now() - tTopDb0;

  const topNoteById = new Map<string, Record<string, unknown>>(topNotes.map((n: unknown) => [String((n as Record<string, unknown>)._id), n as Record<string, unknown>]));
  const topForLLM = topRaw
    .map((x) => ({ ...x, note: topNoteById.get(x.id) }))
    .filter((x) => x.note);

  if (topForLLM.length === 0) {
    ResponseHandler.success(res, { recommendations: [], meta: { recall: 0, final: 0 } }, '候选详情缺失');
    return;
  }

  // LLM 重排输入（仅 TopK）
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

  // ✅ 候选级缓存：每次都做 embedding 召回；命中缓存的候选直接复用；未命中的才丢给 LLM 打分
  const cache = (currentNote as any).recommendCache;
  const cacheOk = cache && cache.algoVersion === ALGO_VERSION && String(cache.sourceUpdatedAt) === String(currentUpdatedAt);
  const cacheById: Record<string, unknown> = cacheOk && cache.byCandidateId && typeof cache.byCandidateId === 'object' ? cache.byCandidateId : {};

  const missing: Array<{ id: string; title: string; summary: string; excerpt: string }> = [];
  const rrMap = new Map<string, { id: string; s2: number; type: string; reason: string }>();
  let cacheHits = 0;

  for (const c of candidates) {
    const cached = cacheById?.[c.id];
    // 只有当候选笔记 updatedAt 未变化时才复用（避免候选内容变了理由/打分过期）
    const candUpdatedAt = String((topForLLM.find((x: { note?: Record<string, unknown> }) => String(x.note?._id) === c.id)?.note)?.updatedAt || '');
    const cachedCandUpdatedAt = String(cached?.candidateUpdatedAt || '');
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

  // 未命中的候选才调用 LLM（只打分/标注/理由，不负责排序，排序由本地代码做）
  const tRerank0 = Date.now();
  if (missing.length > 0) {
    const rr = await rerankRecommendedNotes({ current: currentForLLM, candidates: missing });
    for (const r of rr) rrMap.set(r.id, r);
  }
  const tRerankMs = Date.now() - tRerank0;

  // 融合分数 + 阈值输出
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

  // 写回缓存（候选级别；不阻塞返回；并发下用 updatedAt 做乐观保护）
  void (async () => {
    try {
      const byCandidateId: Record<string, unknown> = cacheOk && cacheById ? { ...cacheById } : {};
      for (const x of topForLLM) {
        const id = String((x as any).note._id);
        const r = rrMap.get(id);
        if (!r) continue;
        byCandidateId[id] = {
          s2: r.s2,
          type: r.type,
          reason: r.reason,
          candidateUpdatedAt: String(((x as any).note as any).updatedAt || ''),
          cachedAt: new Date().toISOString(),
        };
      }
      await Note.updateOne(
        { _id: noteId, userId: user._id, updatedAt: currentUpdatedAt },
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
    } catch (e) {
      logger.warn('⚠️ recommendCache 写入失败（已忽略）:', e);
    }
  })();

  ResponseHandler.success(res, {
    recommendations: out,
    meta: {
      recallQueries: queryItems.length,
      poolSize: pool.length,
      finalInput: topForLLM.length,
      finalOutput: out.length,
      thresholds: { s1Threshold, hardThreshold },
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
  }, '语义联想成功');
}));

export default router;

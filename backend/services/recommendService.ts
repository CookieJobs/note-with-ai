import { Note } from '../models/Note';
import { logger } from '../utils/logger';
import { getCachedQwenEmbedding } from '../utils/embedding';
import { vectorStore } from './vectorStore';
import { rerankRecommendedNotes } from './llmService';

type NoteSummaryRecord = {
  _id: unknown;
  title?: unknown;
  summary?: unknown;
  content?: unknown;
  contentText?: unknown;
  updatedAt?: unknown;
};

type RecommendCacheEntry = {
  s2?: unknown;
  type?: unknown;
  reason?: unknown;
  candidateUpdatedAt?: unknown;
};

type RecommendCandidate = {
  id: string;
  updatedAt: string | Date | undefined;
  s1max: number;
  s1q: number[];
  note?: Record<string, unknown>;
};

type ResolvedRecommendCandidate = RecommendCandidate & {
  note: Record<string, unknown>;
};

type QueryItem = {
  text: string;
  embedding?: number[];
};

type RerankCandidate = {
  id: string;
  title: string;
  summary: string;
  excerpt: string;
};

type CurrentNoteContext = {
  currentNote: any;
  currentText: string;
  currentTitle: string;
  currentSummaryDb: string;
  currentUpdatedAt: unknown;
  queryItems: QueryItem[];
  currentForLLM: {
    id: string;
    title: string;
    summary: string;
    content: string;
  };
  tNoteMs: number;
};

type RecallStageResult = {
  queryCount: number;
  poolSize: number;
  topForLLM: ResolvedRecommendCandidate[];
  tDbMs: number;
  tEmbMs: number;
  tRecallMs: number;
  tTopDbMs: number;
};

type RerankStageResult = {
  rrMap: Map<string, { id: string; s2: number; type: string; reason: string }>;
  cacheHits: number;
  cacheMisses: number;
  cacheOk: unknown;
  cacheById: Record<string, unknown>;
  tRerankMs: number;
};

export type RecommendationWriteMode = 'await' | 'background';

export interface RecommendationOptions {
  recallK?: number;
  finalK?: number;
  s1Threshold?: number;
  hardThreshold?: number;
  writeMode?: RecommendationWriteMode;
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
  message?: string;
}

const ALGO_VERSION = 'semantic-notes-v3';

function buildEmptyResult(message: string, meta: Partial<RecommendationResult['meta']> = {}): RecommendationResult {
  return {
    recommendations: [],
    meta: {
      recallQueries: 0,
      poolSize: 0,
      finalInput: 0,
      finalOutput: 0,
      cacheHits: 0,
      cacheMisses: 0,
      algoVersion: ALGO_VERSION,
      timingsMs: {},
      ...meta,
    },
    message,
  };
}

async function loadCurrentNoteContext(params: {
  noteId: string;
  userId: string;
  t0: number;
}): Promise<{ context?: CurrentNoteContext; emptyResult?: RecommendationResult }> {
  const { noteId, userId, t0 } = params;
  const tNote0 = Date.now();
  const currentNote = await Note.findOne({ _id: noteId, userId });

  if (!currentNote) {
    return {
      emptyResult: buildEmptyResult('笔记不存在或已无权访问', {
        timingsMs: { total: Date.now() - t0 },
      }),
    };
  }

  const currentText = String((currentNote as any).contentText || (currentNote as any).content || '').trim();
  const currentTitle = String((currentNote as any).title || '').trim();
  const currentSummaryDb = String((currentNote as any).summary || '').trim();
  const currentUpdatedAt = (currentNote as any).updatedAt;
  const conceptsDb: string[] = Array.isArray((currentNote as any).concepts) ? (currentNote as any).concepts : [];
  const q0 = `${currentTitle} ${currentText}`.trim();
  const q2 = conceptsDb.length ? conceptsDb.join(' ') : '';
  const q0Embedding: number[] =
    Array.isArray((currentNote as any).embedding) && (currentNote as any).embedding.length > 0
      ? (currentNote as any).embedding
      : [];
  const queryItems: QueryItem[] = [
    q0 ? { text: q0, embedding: q0Embedding.length ? q0Embedding : undefined } : null,
    currentSummaryDb ? { text: currentSummaryDb } : null,
    q2 ? { text: q2 } : null,
  ].filter(Boolean) as QueryItem[];
  const tNoteMs = Date.now() - tNote0;

  if (queryItems.length === 0) {
    return {
      emptyResult: buildEmptyResult('无可用查询文本', {
        timingsMs: {
          total: Date.now() - t0,
          currentNote: tNoteMs,
        },
      }),
    };
  }

  return {
    context: {
      currentNote,
      currentText,
      currentTitle,
      currentSummaryDb,
      currentUpdatedAt,
      queryItems,
      currentForLLM: {
        id: String((currentNote as any)._id),
        title: currentTitle,
        summary: currentSummaryDb,
        content: currentText.slice(0, 600),
      },
      tNoteMs,
    },
  };
}

async function recallTopCandidates(params: {
  noteId: string;
  userId: string;
  queryItems: QueryItem[];
  recallK: number;
  finalK: number;
  s1Threshold: number;
  t0: number;
  tNoteMs: number;
}): Promise<{ stage?: RecallStageResult; emptyResult?: RecommendationResult }> {
  const { noteId, userId, queryItems, recallK, finalK, s1Threshold, t0, tNoteMs } = params;
  const tDb0 = Date.now();
  const userNotesPromise = Note.find({
    userId,
    _id: { $ne: noteId },
    'embedding.0': { $exists: true },
  })
    .select('_id updatedAt embedding')
    .lean();

  const tEmb0 = Date.now();
  const queryEmbeddingsPromise = Promise.all(
    queryItems.map(async (q) => {
      if (Array.isArray(q.embedding) && q.embedding.length > 0) return q.embedding;
      const emb = await getCachedQwenEmbedding(String(q.text || '').trim(), 1024);
      return Array.isArray(emb) ? emb : [];
    })
  );

  const [userNotes, queryEmbeddings] = await Promise.all([userNotesPromise, queryEmbeddingsPromise]);
  const tDbMs = Date.now() - tDb0;
  const tEmbMs = Date.now() - tEmb0;

  if (!Array.isArray(userNotes) || userNotes.length === 0) {
    return {
      emptyResult: buildEmptyResult('没有可用于联想的向量笔记', {
        recallQueries: queryItems.length,
        timingsMs: {
          total: Date.now() - t0,
          currentNote: tNoteMs,
          dbEmbeddings: tDbMs,
          queryEmbeddings: tEmbMs,
        },
      }),
    };
  }

  const merged = new Map<string, RecommendCandidate>();
  for (let qi = 0; qi < queryItems.length; qi++) {
    const emb = queryEmbeddings[qi];
    if (!Array.isArray(emb) || emb.length === 0) continue;
    const hits = vectorStore.searchInMemory(
      emb as any,
      userNotes as any,
      Math.max(1, Math.min(100, Number(recallK))),
      Number(s1Threshold)
    );

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
    return {
      emptyResult: buildEmptyResult('无满足阈值的候选', {
        recallQueries: queryItems.length,
        poolSize: pool.length,
        timingsMs: {
          total: Date.now() - t0,
          currentNote: tNoteMs,
          dbEmbeddings: tDbMs,
          queryEmbeddings: tEmbMs,
          recall: tRecallMs,
        },
      }),
    };
  }

  const tTopDb0 = Date.now();
  const topIds = topRaw.map((x) => x.id);
  const topNotes = await Note.find({ userId, _id: { $in: topIds } })
    .select('_id title summary content contentText updatedAt')
    .lean();
  const tTopDbMs = Date.now() - tTopDb0;

  const topNoteById = new Map<string, Record<string, unknown>>(
    topNotes.map((n: unknown) => [String((n as Record<string, unknown>)._id), n as Record<string, unknown>])
  );
  const topForLLM = topRaw
    .map((x) => ({ ...x, note: topNoteById.get(x.id) }))
    .filter((x): x is ResolvedRecommendCandidate => Boolean(x.note));

  if (topForLLM.length === 0) {
    return {
      emptyResult: buildEmptyResult('候选详情缺失', {
        recallQueries: queryItems.length,
        poolSize: pool.length,
        timingsMs: {
          total: Date.now() - t0,
          currentNote: tNoteMs,
          dbEmbeddings: tDbMs,
          queryEmbeddings: tEmbMs,
          recall: tRecallMs,
          dbTopNotes: tTopDbMs,
        },
      }),
    };
  }

  return {
    stage: {
      queryCount: queryItems.length,
      poolSize: pool.length,
      topForLLM,
      tDbMs,
      tEmbMs,
      tRecallMs,
      tTopDbMs,
    },
  };
}

function buildRerankCandidates(topForLLM: ResolvedRecommendCandidate[]): RerankCandidate[] {
  return topForLLM
    .map((x) => {
      const n = x.note as NoteSummaryRecord | undefined;
      if (!n) return null;
      const title = String(n.title || '').trim();
      const summary = String(n.summary || '').trim();
      const contentText = String(n.contentText || n.content || '').trim();
      const excerpt = (summary || contentText).slice(0, 260);
      return { id: String(n._id), title, summary, excerpt };
    })
    .filter((item): item is RerankCandidate => item !== null);
}

async function resolveRerankStage(params: {
  currentNote: any;
  currentUpdatedAt: unknown;
  currentForLLM: CurrentNoteContext['currentForLLM'];
  topForLLM: ResolvedRecommendCandidate[];
}): Promise<RerankStageResult> {
  const { currentNote, currentUpdatedAt, currentForLLM, topForLLM } = params;
  const candidates = buildRerankCandidates(topForLLM);
  const topNoteById = new Map<string, ResolvedRecommendCandidate>(topForLLM.map((item) => [String(item.note._id), item]));
  const cache = (currentNote as any).recommendCache;
  const cacheOk = cache && cache.algoVersion === ALGO_VERSION && String(cache.sourceUpdatedAt) === String(currentUpdatedAt);
  const cacheById: Record<string, unknown> =
    cacheOk && cache.byCandidateId && typeof cache.byCandidateId === 'object' ? cache.byCandidateId : {};

  const missing: RerankCandidate[] = [];
  const rrMap = new Map<string, { id: string; s2: number; type: string; reason: string }>();
  let cacheHits = 0;

  for (const c of candidates) {
    const cached = cacheById[c.id] as RecommendCacheEntry | undefined;
    const candidate = topNoteById.get(c.id);
    const candUpdatedAt = String(candidate?.note.updatedAt || '');
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

  const tRerank0 = Date.now();
  if (missing.length > 0) {
    const rr = await rerankRecommendedNotes({ current: currentForLLM, candidates: missing });
    for (const r of rr) rrMap.set(r.id, r);
  }
  const tRerankMs = Date.now() - tRerank0;

  return {
    rrMap,
    cacheHits,
    cacheMisses: missing.length,
    cacheOk,
    cacheById,
    tRerankMs,
  };
}

function buildRecommendations(params: {
  topForLLM: ResolvedRecommendCandidate[];
  rrMap: RerankStageResult['rrMap'];
  hardThreshold: number;
}): RecommendationResult['recommendations'] {
  const { topForLLM, rrMap, hardThreshold } = params;
  return topForLLM
    .map((x) => {
      const id = String((x.note as Record<string, unknown>)._id);
      const r = rrMap.get(id);
      const s2 = r?.s2 ?? 0;
      return {
        note: {
          _id: id,
          title: String((x.note as Record<string, unknown>).title || '').trim(),
          summary: String((x.note as Record<string, unknown>).summary || '').trim(),
          contentText: String(
            (x.note as Record<string, unknown>).contentText || (x.note as Record<string, unknown>).content || ''
          ).trim(),
          updatedAt: (x.note as Record<string, unknown>).updatedAt as Date,
        },
        score: 0.3 * x.s1max + 0.7 * s2,
        s1: x.s1max,
        s2,
        type: r?.type || '弱关联',
        reason: r?.reason || '',
      };
    })
    .filter((x) => x.score >= Number(hardThreshold))
    .sort((a, b) => b.score - a.score);
}

async function persistRecommendCache(params: {
  noteId: string;
  userId: string;
  currentUpdatedAt: unknown;
  cacheOk: unknown;
  cacheById: Record<string, unknown>;
  topForLLM: RecommendCandidate[];
  rrMap: Map<string, { id: string; s2: number; type: string; reason: string }>;
  recommendationParams: {
    recallK: number;
    finalK: number;
    s1Threshold: number;
    hardThreshold: number;
  };
}) {
  const { noteId, userId, currentUpdatedAt, cacheOk, cacheById, topForLLM, rrMap, recommendationParams } = params;
  const byCandidateId: Record<string, unknown> = cacheOk ? { ...cacheById } : {};

  for (const x of topForLLM) {
    const id = String((x.note as Record<string, unknown>)._id);
    const r = rrMap.get(id);
    if (!r) continue;
    byCandidateId[id] = {
      s1: x.s1max,
      s2: r.s2,
      type: r.type,
      reason: r.reason,
      candidateUpdatedAt: String((x.note as Record<string, unknown>).updatedAt || ''),
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
          params: recommendationParams,
          byCandidateId,
        },
      },
    }
  );
}

/**
 * 核心推荐服务：统一编排在线接口与批处理脚本的推荐计算与缓存写回。
 */
export async function updateNoteRecommendations(
  noteId: string,
  userId: string,
  options: RecommendationOptions = {}
): Promise<RecommendationResult> {
  const {
    recallK = 30,
    finalK = 10,
    s1Threshold = 0.50,
    hardThreshold = 0.75,
    writeMode = 'await',
  } = options;

  const t0 = Date.now();
  const currentNoteStage = await loadCurrentNoteContext({ noteId, userId, t0 });
  if (currentNoteStage.emptyResult) {
    return currentNoteStage.emptyResult;
  }

  const currentContext = currentNoteStage.context!;
  const recallStageResult = await recallTopCandidates({
    noteId,
    userId,
    queryItems: currentContext.queryItems,
    recallK,
    finalK,
    s1Threshold,
    t0,
    tNoteMs: currentContext.tNoteMs,
  });
  if (recallStageResult.emptyResult) {
    return recallStageResult.emptyResult;
  }

  const recallStage = recallStageResult.stage!;
  const rerankStage = await resolveRerankStage({
    currentNote: currentContext.currentNote,
    currentUpdatedAt: currentContext.currentUpdatedAt,
    currentForLLM: currentContext.currentForLLM,
    topForLLM: recallStage.topForLLM,
  });
  const recommendations = buildRecommendations({
    topForLLM: recallStage.topForLLM,
    rrMap: rerankStage.rrMap,
    hardThreshold,
  });

  const cacheWriteTask = persistRecommendCache({
    noteId,
    userId,
    currentUpdatedAt: currentContext.currentUpdatedAt,
    cacheOk: rerankStage.cacheOk,
    cacheById: rerankStage.cacheById,
    topForLLM: recallStage.topForLLM,
    rrMap: rerankStage.rrMap,
    recommendationParams: { recallK, finalK, s1Threshold, hardThreshold },
  });

  if (writeMode === 'background') {
    void cacheWriteTask.catch((error: unknown) => {
      logger.warn('⚠️ recommendCache 写入失败（已忽略）:', error);
    });
  } else {
    await cacheWriteTask;
  }

  return {
    recommendations,
    meta: {
      recallQueries: recallStage.queryCount,
      poolSize: recallStage.poolSize,
      finalInput: recallStage.topForLLM.length,
      finalOutput: recommendations.length,
      cacheHits: rerankStage.cacheHits,
      cacheMisses: rerankStage.cacheMisses,
      algoVersion: ALGO_VERSION,
      timingsMs: {
        total: Date.now() - t0,
        currentNote: currentContext.tNoteMs,
        dbEmbeddings: recallStage.tDbMs,
        queryEmbeddings: recallStage.tEmbMs,
        recall: recallStage.tRecallMs,
        dbTopNotes: recallStage.tTopDbMs,
        rerank: rerankStage.tRerankMs,
      },
    },
    message: recommendations.length > 0 ? '语义联想成功' : '无满足阈值的候选',
  };
}

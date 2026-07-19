import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-dashscope-key';
process.env.EMBEDDING_PROVIDER = 'openrouter';
process.env.EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';
process.env.EMBEDDING_DIMENSION = '2048';

global.setInterval = (((_callback: (...args: any[]) => void, _ms?: number, ..._args: any[]) => {
  return 0 as any;
}) as typeof setInterval);

const manualRestores: Array<() => void> = [];

function createFindResult<T>(rows: T[]) {
  return {
    select() {
      return this;
    },
    lean: async () => rows,
  };
}

async function loadModules() {
  return {
    Note: require('../models/Note').Note,
    vectorStore: require('../services/vectorStore').vectorStore,
    updateNoteRecommendations: require('../services/recommendService').updateNoteRecommendations,
    axios: require('axios').default,
  };
}

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  manualRestores.push(() => {
    (target as any)[key] = original;
  });
}

describe('recommendService', () => {
  afterEach(() => {
    mock.restoreAll();
    while (manualRestores.length > 0) {
      manualRestores.pop()?.();
    }
  });

  it('在召回为空时返回阈值与诊断信息，便于定位被 s1Threshold 过滤的情况', async () => {
    const { Note, vectorStore, updateNoteRecommendations, axios } = await loadModules();
    const requests: Array<Record<string, unknown>> = [];
    const noteFindQueries: Array<Record<string, unknown>> = [];

    const currentNote = {
      _id: 'note-current',
      userId: 'user-1',
      title: '当前笔记',
      contentText: '当前内容',
      content: '当前内容',
      summary: '',
      concepts: [],
      embedding: [0.11, 0.22, 0.33],
      updatedAt: new Date('2025-12-01T00:00:00.000Z'),
      recommendCache: null,
    };
    const userNotes = [
      { _id: 'note-a', updatedAt: new Date('2025-12-02T00:00:00.000Z'), embedding: [0.4, 0.1, 0.2] },
      { _id: 'note-b', updatedAt: new Date('2025-12-03T00:00:00.000Z'), embedding: [0.3, 0.2, 0.1] },
    ];

    mock.method(Note, 'findOne', async () => currentNote as any);
    mock.method(Note, 'find', (query: Record<string, unknown>) => {
      noteFindQueries.push(query);
      if ('embedding.0' in query) {
        return createFindResult(userNotes);
      }
      return createFindResult([]);
    });
    const updateOneCalls: Array<{ filter: Record<string, unknown>; update: Record<string, any> }> = [];
    mock.method(Note, 'updateOne', async (filter: Record<string, unknown>, update: Record<string, any>) => {
      updateOneCalls.push({ filter, update });
      return { matchedCount: 1 } as any;
    });
    replaceMethod(vectorStore, 'searchInMemory', ((_: number[], candidates: Record<string, unknown>[]) => {
      return [
        { item: candidates[0], score: 0.39 },
        { item: candidates[1], score: 0.38 },
      ];
    }) as any);
    replaceMethod(axios, 'post', (async (_url: string, body: Record<string, unknown>) => {
      requests.push(body);
      return {
        data: {
          data: [{ embedding: [0.21, 0.22, 0.23] }],
        },
      };
    }) as any);

    const result = await updateNoteRecommendations('note-current', 'user-1');

    assert.equal(result.message, '无满足阈值的候选');
    assert.deepEqual(result.recommendations, []);
    assert.deepEqual(result.meta.thresholds, {
      s1Threshold: 0.35,
      hardThreshold: 0.65,
    });
    assert.equal(result.meta.poolSize, 0);
    assert.deepEqual(result.meta.diagnostics, {
      stage: 'recall',
      reason: 'all_candidates_below_s1_threshold',
      totalVectorNotes: 2,
      totalScoredCandidates: 2,
      totalQueryEmbeddings: 1,
      readyQueryEmbeddings: 1,
      bestS1Score: 0.39,
      candidateCountsByThreshold: {
        '0.35': 2,
        '0.40': 0,
        '0.45': 0,
        '0.50': 0,
      },
    });
    assert.equal(noteFindQueries[0]['embeddingMetadata.provider'], 'openrouter');
    assert.equal(noteFindQueries[0]['embeddingMetadata.model'], 'nvidia/llama-nemotron-embed-vl-1b-v2:free');
    assert.equal(noteFindQueries[0]['embeddingMetadata.dimension'], 2048);
    assert.equal(noteFindQueries[0]['embeddingMetadata.modality'], 'text');
    assert.equal(updateOneCalls.length, 1);
    assert.deepEqual(updateOneCalls[0].filter, {
      _id: 'note-current',
      userId: 'user-1',
      updatedAt: currentNote.updatedAt,
    });
    assert.deepEqual(updateOneCalls[0].update, {
      $set: {
        recommendCache: {
          algoVersion: 'semantic-notes-v3',
          sourceUpdatedAt: currentNote.updatedAt,
          generatedAt: updateOneCalls[0].update.$set.recommendCache.generatedAt,
          params: {
            recallK: 30,
            finalK: 10,
            s1Threshold: 0.35,
            hardThreshold: 0.65,
          },
          diagnostics: {
            stage: 'recall',
            reason: 'all_candidates_below_s1_threshold',
            totalVectorNotes: 2,
            totalScoredCandidates: 2,
            totalQueryEmbeddings: 1,
            readyQueryEmbeddings: 1,
            bestS1Score: 0.39,
            candidateCountsByThreshold: {
              '0.35': 2,
              '0.40': 0,
              '0.45': 0,
              '0.50': 0,
            },
          },
          byCandidateId: {},
        },
      },
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input_type, 'search_query');
  });
});

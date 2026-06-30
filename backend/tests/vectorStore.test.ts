import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';
process.env.EMBEDDING_PROVIDER = 'openrouter';
process.env.EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';
process.env.EMBEDDING_DIMENSION = '2048';

global.setInterval = (((_callback: (...args: any[]) => void, _ms?: number, ..._args: any[]) => {
  return 0 as any;
}) as typeof setInterval);

async function loadModules() {
  return {
    Note: require('../models/Note').Note,
    vectorStore: require('../services/vectorStore').vectorStore,
  };
}

describe('vectorStore', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('search 仅查询当前 embedding metadata 空间中的笔记', async () => {
    const { Note, vectorStore } = await loadModules();
    const queries: Array<Record<string, unknown>> = [];

    mock.method(Note, 'find', (query: Record<string, unknown>) => {
      queries.push(query);
      return {
        lean: async () => [],
      } as any;
    });

    const result = await vectorStore.search('user-1', [0.1, 0.2, 0.3], 5);

    assert.deepEqual(result, []);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0], {
      userId: 'user-1',
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } },
      'embeddingMetadata.provider': 'openrouter',
      'embeddingMetadata.model': 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
      'embeddingMetadata.dimension': 2048,
      'embeddingMetadata.modality': 'text',
    });
  });
});

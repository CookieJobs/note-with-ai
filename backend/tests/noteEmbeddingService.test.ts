import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

function createQueryResult<T>(rows: T[]) {
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    populate() {
      return this;
    },
    limit: async () => rows,
  };
}

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'http://localhost:27017';
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-dashscope-key';

global.setInterval = (((_callback: (...args: any[]) => void, _ms?: number, ..._args: any[]) => {
  return 0 as any;
}) as typeof setInterval);

const manualRestores: Array<() => void> = [];

async function loadModules() {
  return {
    Note: require('../models/Note').Note,
    noteEmbeddingService: require('../services/noteEmbeddingService').noteEmbeddingService,
    logger: require('../utils/logger').logger,
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

describe('noteEmbeddingService', () => {
  afterEach(() => {
    mock.restoreAll();
    while (manualRestores.length > 0) {
      manualRestores.pop()?.();
    }
    delete process.env.EMBEDDING_BATCH_SIZE;
  });

  it('buildEmbeddingText 优先使用 contentText，然后回退到 content 和 title', async () => {
    const { noteEmbeddingService } = await loadModules();
    assert.equal(
      noteEmbeddingService.buildEmbeddingText({ title: '标题', content: '正文', contentText: '纯文本正文' } as any),
      '纯文本正文'
    );
    assert.equal(
      noteEmbeddingService.buildEmbeddingText({ title: '标题', content: '正文', contentText: '   ' } as any),
      '正文'
    );
    assert.equal(
      noteEmbeddingService.buildEmbeddingText({ title: '标题', content: '   ', contentText: '' } as any),
      '标题'
    );
  });

  it('generateEmbeddingForNote 在版本保护写回失败时返回 skipped', async () => {
    const { Note, noteEmbeddingService, axios } = await loadModules();
    const updatedAt = new Date('2024-01-01T00:00:00.000Z');
    const note = {
      _id: { toString: () => 'note-1' },
      userId: 'user-1',
      title: '标题',
      content: '正文',
      contentText: '纯文本正文',
      updatedAt,
    };

    mock.method(Note, 'findOne', () => ({
      select: async () => note,
    }) as any);
    replaceMethod(axios, 'post', (async () => ({
      data: {
        output: {
          embeddings: [{ embedding: [0.1, 0.2, 0.3] }],
        },
      },
    })) as any);
    mock.method(Note, 'updateOne', async () => ({ matchedCount: 0 }) as any);

    const result = await noteEmbeddingService.generateEmbeddingForNote('user-1', 'note-1');
    assert.deepEqual(result, { skipped: true });
  });

  it('repairAllEmbeddings 会跳过空文本坏数据并继续处理后续批次', async () => {
    const { Note, noteEmbeddingService, logger, axios } = await loadModules();
    process.env.EMBEDDING_BATCH_SIZE = '1';

    const blankNote = {
      _id: { toString: () => 'blank-note' },
      userId: 'user-1',
      title: '',
      content: '',
      contentText: '',
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    };
    const validNote = {
      _id: { toString: () => 'valid-note' },
      userId: 'user-1',
      title: '',
      content: '有效正文',
      contentText: '',
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    };

    const findQueries: Array<Record<string, any>> = [];
    let validEmbedded = false;
    mock.method(Note, 'find', (query: Record<string, any>) => {
      findQueries.push(query);
      const excludedIds = new Set<string>((query._id?.$nin || []).map((id: any) => String(id)));

      if (!excludedIds.has('blank-note')) {
        return createQueryResult([blankNote]);
      }
      if (!excludedIds.has('valid-note') && !validEmbedded) {
        return createQueryResult([validNote]);
      }
      return createQueryResult([]);
    });

    const savedFilters: Array<Record<string, any>> = [];
    mock.method(Note, 'updateOne', async (filter: Record<string, any>) => {
      savedFilters.push(filter);
      if (String(filter._id) === 'valid-note') {
        validEmbedded = true;
      }
      return { matchedCount: 1 } as any;
    });
    replaceMethod(axios, 'post', (async (_url: string, body: Record<string, any>) => {
      const contents = body.input?.contents || [];
      return {
        data: {
          output: {
            embeddings: contents.map(() => ({ embedding: [0.1, 0.2] })),
          },
        },
      };
    }) as any);
    mock.method(logger, 'info', () => undefined as any);
    mock.method(logger, 'warn', () => undefined as any);

    const result = await noteEmbeddingService.repairAllEmbeddings();

    assert.equal(result.processedCount, 2);
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 1);
    assert.deepEqual(result.failures, [
      { noteId: 'blank-note', error: '缺少可用于 embedding 的文本' },
    ]);
    assert.equal(savedFilters.length, 1);
    assert.equal(String(savedFilters[0]._id), 'valid-note');
    assert.ok(Array.isArray(findQueries[1]._id.$nin));
    assert.ok(findQueries[1]._id.$nin.includes('blank-note'));
  });

  it('repairAllEmbeddings 会把版本保护导致的旧向量写回失败记为 failure 并跳过重试', async () => {
    const { Note, noteEmbeddingService, logger, axios } = await loadModules();
    process.env.EMBEDDING_BATCH_SIZE = '1';

    const staleNote = {
      _id: { toString: () => 'stale-note' },
      userId: 'user-1',
      title: '标题',
      content: '会并发更新的正文',
      contentText: '',
      updatedAt: new Date('2024-01-03T00:00:00.000Z'),
    };
    const validNote = {
      _id: { toString: () => 'valid-note' },
      userId: 'user-1',
      title: '标题',
      content: '稳定正文',
      contentText: '',
      updatedAt: new Date('2024-01-04T00:00:00.000Z'),
    };

    const findQueries: Array<Record<string, any>> = [];
    let validEmbedded = false;
    mock.method(Note, 'find', (query: Record<string, any>) => {
      findQueries.push(query);
      const excludedIds = new Set<string>((query._id?.$nin || []).map((id: any) => String(id)));

      if (!excludedIds.has('stale-note')) {
        return createQueryResult([staleNote]);
      }
      if (!excludedIds.has('valid-note') && !validEmbedded) {
        return createQueryResult([validNote]);
      }
      return createQueryResult([]);
    });

    mock.method(Note, 'updateOne', async (filter: Record<string, any>) => {
      if (String(filter._id) === 'stale-note') {
        return { matchedCount: 0 } as any;
      }
      if (String(filter._id) === 'valid-note') {
        validEmbedded = true;
      }
      return { matchedCount: 1 } as any;
    });
    replaceMethod(axios, 'post', (async (_url: string, body: Record<string, any>) => {
      const contents = body.input?.contents || [];
      return {
        data: {
          output: {
            embeddings: contents.map(() => ({ embedding: [0.1, 0.2] })),
          },
        },
      };
    }) as any);
    mock.method(logger, 'info', () => undefined as any);
    mock.method(logger, 'warn', () => undefined as any);

    const result = await noteEmbeddingService.repairAllEmbeddings();

    assert.equal(result.processedCount, 2);
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 1);
    assert.deepEqual(result.failures, [
      { noteId: 'stale-note', error: '笔记在 embedding 生成期间已更新，跳过旧向量写入' },
    ]);
    assert.ok(Array.isArray(findQueries[1]._id.$nin));
    assert.ok(findQueries[1]._id.$nin.includes('stale-note'));
  });
});

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

const manualRestores: Array<() => void> = [];

async function loadModules() {
  return {
    axios: require('axios').default,
    vectorStore: require('../services/vectorStore').vectorStore,
    chatRelatedNoteRecallService: require('../services/chatRelatedNoteRecallService').chatRelatedNoteRecallService,
  };
}

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  manualRestores.push(() => {
    (target as any)[key] = original;
  });
}

describe('chatRelatedNoteRecallService', () => {
  afterEach(() => {
    mock.restoreAll();
    while (manualRestores.length > 0) {
      manualRestores.pop()?.();
    }
  });

  it('recallFromMessages 使用 search_query 语义生成聊天召回向量', async () => {
    const { axios, vectorStore, chatRelatedNoteRecallService } = await loadModules();
    const requests: Array<Record<string, unknown>> = [];

    replaceMethod(axios, 'post', (async (_url: string, body: Record<string, unknown>) => {
      requests.push(body);
      return {
        data: {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        },
      };
    }) as any);
    replaceMethod(vectorStore, 'search', (async () => ([
      {
        item: {
          _id: 'note-1',
          title: '相关笔记',
          content: '命中的内容',
          createdAt: '2026-06-01T00:00:00.000Z',
        },
        score: 0.88,
      },
    ])) as any);

    const result = await chatRelatedNoteRecallService.recallFromMessages({
      userId: 'user-1',
      messages: [
        { role: 'user', content: '帮我回忆一下最近做的 embedding 改造' },
        { role: 'assistant', content: '你最近在切换 OpenRouter 的检索语义' },
      ],
      limit: 3,
      threshold: 0.5,
    });

    assert.deepEqual(result, [
      {
        noteId: 'note-1',
        title: '相关笔记',
        content: '命中的内容',
        score: 0.88,
        matchType: 'vector',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input_type, 'search_query');
  });
});

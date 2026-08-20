import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-deepseek-key';
process.env.DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://example.com';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';
process.env.EMBEDDING_PROVIDER = 'openrouter';
process.env.EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';
process.env.EMBEDDING_DIMENSION = '2048';
process.env.EMBEDDING_QUERY_INPUT_TYPE = 'search_query';
process.env.EMBEDDING_DOCUMENT_INPUT_TYPE = 'search_document';

global.setInterval = (((_callback: (...args: any[]) => void, _ms?: number, ..._args: any[]) => {
  return 0 as any;
}) as typeof setInterval);

const manualRestores: Array<() => void> = [];

async function loadModules() {
  return {
    chatService: require('../services/chatService').chatService,
    chatRelatedNoteRecallService: require('../services/chatRelatedNoteRecallService').chatRelatedNoteRecallService,
    chatTurnCommitService: require('../services/chatTurnCommitService').chatTurnCommitService,
  };
}

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  manualRestores.push(() => {
    (target as any)[key] = original;
  });
}

describe('chatTurnCommitService', () => {
  afterEach(() => {
    mock.restoreAll();
    while (manualRestores.length > 0) {
      manualRestores.pop()?.();
    }
  });

  it('在流式结束后统一补齐标题与相关笔记，并只提交一次最终快照', async () => {
    const { chatService, chatRelatedNoteRecallService, chatTurnCommitService } = await loadModules();

    const streamMessages: Array<{ role: string; content: string }> = [];
    replaceMethod(chatService, 'streamChat', (async (messages: Array<{ role: string; content: string }>) => {
      streamMessages.push(...messages);
      async function* generator() {
        yield '你好';
        yield '世界';
      }
      return generator();
    }) as any);

    const summarized: Array<{ userContent: string; aiContent: string }> = [];
    replaceMethod(chatService, 'summarizeTitle', (async (userContent: string, aiContent: string) => {
      summarized.push({ userContent, aiContent });
      return '自动标题';
    }) as any);

    const recalledMessages: Array<Array<{ role: string; content: string }>> = [];
    replaceMethod(chatRelatedNoteRecallService, 'recallFromMessages', (async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
      recalledMessages.push(messages);
      return [
        {
          noteId: 'note-1',
          title: '关联笔记',
          content: '命中的片段',
          score: 0.88,
          matchType: 'vector',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ];
    }) as any);

    const saveCalls: Array<Record<string, unknown>> = [];
    replaceMethod(chatService, 'saveSession', (async (
      userId: string,
      sessionId: string | undefined,
      messages: Array<{ role: string; content: string }>,
      title?: string,
      relatedNotes?: unknown[],
    ) => {
      saveCalls.push({ userId, sessionId, messages, title, relatedNotes });
      return {
        _id: 'chat-1',
        title: title || '默认标题',
        messages,
        relatedNotes,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
      };
    }) as any);

    replaceMethod(chatService, 'formatSession', ((session: Record<string, unknown>) => session) as any);

    const chunks: string[] = [];
    const result = await chatTurnCommitService.streamAndCommit({
      userId: 'user-1',
      sessionId: 'session-1',
      title: '旧标题',
      messages: [
        { role: 'user', content: '最近怎么样？' },
      ],
      onChunk: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    });

    assert.deepEqual(chunks, ['你好', '世界']);
    assert.deepEqual(streamMessages, [{ role: 'user', content: '最近怎么样？' }]);
    assert.deepEqual(summarized, [{ userContent: '最近怎么样？', aiContent: '你好世界' }]);
    assert.equal(recalledMessages.length, 1);
    assert.deepEqual(recalledMessages[0], [
      { role: 'user', content: '最近怎么样？' },
      { role: 'assistant', content: '你好世界' },
    ]);
    assert.equal(saveCalls.length, 1);
    assert.deepEqual(saveCalls[0], {
      userId: 'user-1',
      sessionId: 'session-1',
      messages: [
        { role: 'user', content: '最近怎么样？' },
        { role: 'assistant', content: '你好世界' },
      ],
      title: '自动标题',
      relatedNotes: [
        {
          noteId: 'note-1',
          title: '关联笔记',
          content: '命中的片段',
          score: 0.88,
          matchType: 'vector',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
    });
    assert.equal(result.fullReply, '你好世界');
    assert.deepEqual(result.session, {
      _id: 'chat-1',
      title: '自动标题',
      messages: [
        { role: 'user', content: '最近怎么样？' },
        { role: 'assistant', content: '你好世界' },
      ],
      relatedNotes: [
        {
          noteId: 'note-1',
          title: '关联笔记',
          content: '命中的片段',
          score: 0.88,
          matchType: 'vector',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
  });

  it('在标题或相关笔记富化失败时降级为基础提交，不阻断消息落库', async () => {
    const { chatService, chatRelatedNoteRecallService, chatTurnCommitService } = await loadModules();

    replaceMethod(chatService, 'streamChat', (async () => {
      async function* generator() {
        yield '收到';
      }
      return generator();
    }) as any);

    replaceMethod(chatService, 'summarizeTitle', (async () => {
      throw new Error('summary failed');
    }) as any);

    replaceMethod(chatRelatedNoteRecallService, 'recallFromMessages', (async () => {
      throw new Error('recall failed');
    }) as any);

    const saveCalls: Array<Record<string, unknown>> = [];
    replaceMethod(chatService, 'saveSession', (async (
      userId: string,
      sessionId: string | undefined,
      messages: Array<{ role: string; content: string }>,
      title?: string,
      relatedNotes?: unknown[],
    ) => {
      saveCalls.push({ userId, sessionId, messages, title, relatedNotes });
      return {
        _id: 'chat-2',
        title: title || '原始标题',
        messages,
        relatedNotes: relatedNotes || [],
      };
    }) as any);

    replaceMethod(chatService, 'formatSession', ((session: Record<string, unknown>) => session) as any);

    const result = await chatTurnCommitService.streamAndCommit({
      userId: 'user-2',
      sessionId: undefined,
      title: '原始标题',
      messages: [
        { role: 'user', content: '给我一句回应' },
      ],
      onChunk: () => true,
    });

    assert.equal(saveCalls.length, 1);
    assert.deepEqual(saveCalls[0], {
      userId: 'user-2',
      sessionId: undefined,
      messages: [
        { role: 'user', content: '给我一句回应' },
        { role: 'assistant', content: '收到' },
      ],
      title: '原始标题',
      relatedNotes: [],
    });
    assert.equal(result.fullReply, '收到');
  });
});

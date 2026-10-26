import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStream } from './useChatStream';
import type { IChat } from '../types';

const {
  authFetch: mockAuthFetchFn,
  persistChatSessions: mockPersistChatSessions,
  replaceSessionId: mockReplaceSessionId,
} = vi.hoisted(() => ({
  authFetch: vi.fn(),
  persistChatSessions: vi.fn(),
  replaceSessionId: vi.fn(
    (sessions: IChat[], oldId: string, newId: string) =>
      sessions.map((s) => (s.id === oldId ? { ...s, id: newId } : s)),
  ),
}));

vi.mock('../utils/auth', () => ({
  authFetch: mockAuthFetchFn,
}));

vi.mock('./chatSessionStore', () => ({
  persistChatSessions: mockPersistChatSessions,
  replaceSessionId: mockReplaceSessionId,
}));

function makeSession(overrides: Partial<IChat> = {}): IChat {
  return {
    id: 'session-1',
    title: '测试会话',
    messages: [{ role: 'user', content: '你好' }],
    ...overrides,
  };
}

function makeSseReader(chunks: string[]) {
  const encoded = chunks.map((c) => new TextEncoder().encode(c));
  let i = 0;
  return {
    read: vi.fn(async () => {
      if (i < encoded.length) return { done: false, value: encoded[i++] };
      return { done: true };
    }),
    cancel: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };
}

/**
 * Mocks authFetch to return { ok: true, body: { getReader: () => reader } }.
 */
function mockAuthFetchSuccess(reader?: ReturnType<typeof makeSseReader>) {
  mockAuthFetchFn.mockResolvedValueOnce({
    ok: true,
    status: 200,
    body: reader ? { getReader: () => reader } : null,
    json: vi.fn(async () => ({})),
  });
}

/** Count how many times authFetch was called with the given URL. */
function getAuthFetchCallCount(url: string) {
  return mockAuthFetchFn.mock.calls.filter(
    (call: unknown[]) => call[0] === url,
  ).length;
}

/**
 * Returns a mock setSessions that actually invokes the updater callback,
 * so that internal calls to replaceSessionId / persistChatSessions are exercised.
 */
function makeSetSessionsMock(initial: IChat[] = []) {
  let state = initial;
  const fn = vi.fn((updater: IChat[] | ((prev: IChat[]) => IChat[])) => {
    if (typeof updater === 'function') {
      state = updater(state);
    } else {
      state = updater;
    }
    return state;
  });
  return { setSessions: fn, getState: () => state };
}

describe('useChatStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies the active request and retains its error identity while refusing a concurrent stream', async () => {
    let finish!: (response: unknown) => void;
    mockAuthFetchFn.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useChatStream());
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.sendMessage('A问题', makeSession({ id: 'A' }), 'user-1', vi.fn(), vi.fn()); });
    expect(result.current.activeSessionId).toBe('A');
    await act(async () => { expect(await result.current.sendMessage('B问题', makeSession({ id: 'B' }), 'user-1', vi.fn(), vi.fn())).toBe(false); });
    expect(mockAuthFetchFn).toHaveBeenCalledOnce();
    await act(async () => { finish({ ok: false, json: async () => ({ error: '来源笔记已删除' }) }); await pending; });
    expect(result.current.activeSessionId).toBe(null);
    expect(result.current.errorSessionId).toBe('A');
    expect(result.current.error).toContain('来源笔记已删除');
  });

  // --- Guard clauses ---

  it('does nothing when input is empty', async () => {
    const { result } = renderHook(() => useChatStream());
    const setSessions = vi.fn();

    await act(async () => {
      await result.current.sendMessage(
        '   ',
        makeSession(),
        'user-1',
        vi.fn(),
        setSessions,
      );
    });

    expect(setSessions).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('sets error when currentSession is nullish', async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.sendMessage(
        'hello',
        null as unknown as IChat,
        'user-1',
        vi.fn(),
        vi.fn(),
      );
    });

    expect(result.current.error).toBe('当前会话不存在，无法发送消息');
  });

  it('sets error when userId is empty', async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      await result.current.sendMessage(
        'hello',
        makeSession(),
        '',
        vi.fn(),
        vi.fn(),
      );
    });

    expect(result.current.error).toBe('用户未初始化，无法发送消息');
  });

  it('prevents duplicate sends via loadingRef', async () => {
    const { result } = renderHook(() => useChatStream());
    const { setSessions } = makeSetSessionsMock([makeSession()]);
    const updateMessages1 = vi.fn();
    const updateMessages2 = vi.fn();

    const reader = makeSseReader(['data: [DONE]\n\n']);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      const first = result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages1,
        setSessions,
      );
      const second = result.current.sendMessage(
        'hi again',
        makeSession(),
        'user-1',
        updateMessages2,
        vi.fn(),
      );

      await Promise.all([first, second]);
    });

    // First send should have progressed (updateMessages called)
    expect(updateMessages1).toHaveBeenCalled();
    // Second send should have been blocked
    expect(updateMessages2).not.toHaveBeenCalled();
    // /api/chat should only have been hit once
    expect(getAuthFetchCallCount('/api/chat')).toBe(1);
  });

  // --- Streaming flow ---

  it('sends the selected note while keeping cached source snapshots out of the client transcript', async () => {
    const { result } = renderHook(() => useChatStream());
    const snapshot = { noteId: 'note-1', contentText: '周三20分钟', revision: 2, updatedAt: '2026-10-18T00:00:00.000Z', hasImages: false };
    const session = makeSession({ id: 'local_1', sourceNoteId: 'note-1', messages: [{ role: 'assistant', content: '开场', sourceSnapshot: snapshot }] } as Partial<IChat>);
    mockAuthFetchSuccess(makeSseReader(['data: [DONE]\n\n']));

    await act(async () => { await result.current.sendMessage('怎么安排？', session, 'user-1', vi.fn(), vi.fn()); });

    expect(JSON.parse(mockAuthFetchFn.mock.calls[0][1].body)).toEqual({
      sourceNoteId: 'note-1',
      messages: [{ role: 'assistant', content: '开场' }, { role: 'user', content: '怎么安排？' }],
    });
  });

  it('retains the authoritative same-ID committed transcript and answer snapshot after streaming ends', async () => {
    const snapshot = { noteId: 'note-1', title: '学习安排', contentText: '周三20分钟', revision: 3, updatedAt: '2026-10-18T01:00:00.000Z', hasImages: false };
    const committed = { ...makeSession(), sourceNoteId: 'note-1', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: '已保存的回答', sourceSnapshot: snapshot }] };
    const { result } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession()]);
    mockAuthFetchSuccess(makeSseReader(['data: {"chunk":"暂时的流式文字"}\n\n', `data: ${JSON.stringify({ type: 'committed', session: committed })}\n\n`, 'data: [DONE]\n\n']));

    await act(async () => { await result.current.sendMessage('hi', makeSession(), 'user-1', vi.fn(), state.setSessions); });

    expect(state.getState()[0]).toMatchObject(committed);
  });

  it('keeps a failed question without a placeholder answer and reuses it when retried', async () => {
    const { result } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession({ messages: [] })]);
    const updateMessages = (id: string, messages: IChat['messages']) => state.setSessions(previous => previous.map(session => session.id === id ? { ...session, messages } : session));
    mockAuthFetchSuccess(makeSseReader(['data: {"error":"笔记已删除，请选择其他笔记"}\n\n']));

    await act(async () => { await result.current.sendMessage('这个安排如何？', state.getState()[0], 'user-1', updateMessages, state.setSessions); });
    expect(result.current.error).toContain('笔记已删除');
    expect(state.getState()[0].messages).toEqual([{ role: 'user', content: '这个安排如何？' }]);

    mockAuthFetchFn.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: '笔记已删除，请选择其他笔记' }) });
    await act(async () => { await result.current.sendMessage('这个安排如何？', state.getState()[0], 'user-1', updateMessages, state.setSessions); });
    expect(JSON.parse(mockAuthFetchFn.mock.calls[1][1].body).messages).toEqual([{ role: 'user', content: '这个安排如何？' }]);
  });

  it.each([
    { ending: 'EOF', chunks: [] },
    { ending: '[DONE]', chunks: ['data: [DONE]\n\n'] },
  ])('rejects a bound reply ending at $ending before its answer snapshot is committed', async ({ chunks }) => {
    const { result } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession({ sourceNoteId: 'note-1', messages: [] })]);
    const updateMessages = (id: string, messages: IChat['messages']) => state.setSessions(previous => previous.map(session => session.id === id ? { ...session, messages } : session));
    mockAuthFetchSuccess(makeSseReader(['data: {"chunk":"尚未保存的回答"}\n\n', ...chunks]));
    let sent: boolean | undefined;

    await act(async () => {
      sent = await result.current.sendMessage('这个安排如何？', state.getState()[0], 'user-1', updateMessages, state.setSessions);
    });

    expect(sent).toBe(false);
    expect(result.current.error).toMatch(/未.*保存|保存.*未/);
    expect(result.current.loading).toBe(false);
    expect(state.getState()[0].messages).toEqual([{ role: 'user', content: '这个安排如何？' }]);
  });

  it('does not report an ordinary partial reply as successful without a committed session', async () => {
    const { result } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession({ messages: [] })]);
    const updateMessages = (id: string, messages: IChat['messages']) => state.setSessions(previous => previous.map(session => session.id === id ? { ...session, messages } : session));
    mockAuthFetchSuccess(makeSseReader(['data: {"chunk":"尚未保存的回答"}\n\n', 'data: [DONE]\n\n']));
    let sent: boolean | undefined;

    await act(async () => {
      sent = await result.current.sendMessage('请解释这个问题', state.getState()[0], 'user-1', updateMessages, state.setSessions);
    });

    expect(sent).toBe(false);
    expect(result.current.error).toMatch(/保存/);
    expect(result.current.loading).toBe(false);
    expect(state.getState()[0].messages).toEqual([{ role: 'user', content: '请解释这个问题' }]);
  });

  it('releases loading with a retryable error when the stream has no data for 60 seconds', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession({ messages: [] })]);
    const updateMessages = (id: string, messages: IChat['messages']) => state.setSessions(previous => previous.map(session => session.id === id ? { ...session, messages } : session));
    let requestSignal!: AbortSignal;
    const reader = {
      read: vi.fn(() => new Promise<never>((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      })),
      cancel: vi.fn(async () => {}),
      releaseLock: vi.fn(),
    };
    mockAuthFetchFn.mockImplementation((_url: string, options: RequestInit) => {
      requestSignal = options.signal as AbortSignal;
      return Promise.resolve({ ok: true, body: { getReader: () => reader }, json: async () => ({}) });
    });
    let sendPromise!: Promise<boolean>;

    try {
      await act(async () => {
        sendPromise = result.current.sendMessage('继续刚才的问题', state.getState()[0], 'user-1', updateMessages, state.setSessions);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.loading).toBe(true);

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toMatch(/超时|中断|重试/);
      expect(await sendPromise).toBe(false);
      expect(state.getState()[0].messages).toEqual([{ role: 'user', content: '继续刚才的问题' }]);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('releases loading with a retryable error when the request itself never returns', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession({ messages: [] })]);
    const updateMessages = (id: string, messages: IChat['messages']) => state.setSessions(previous => previous.map(session => session.id === id ? { ...session, messages } : session));
    mockAuthFetchFn.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      (options.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    let sendPromise!: Promise<boolean>;

    try {
      await act(async () => {
        sendPromise = result.current.sendMessage('等待网络的提问', state.getState()[0], 'user-1', updateMessages, state.setSessions);
        await Promise.resolve();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toMatch(/超时/);
      expect(await sendPromise).toBe(false);
      expect(state.getState()[0].messages).toEqual([{ role: 'user', content: '等待网络的提问' }]);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('ignores a committed response delivered after timeout while a newer send is in flight', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession({ messages: [] })]);
    const updateMessages = (id: string, messages: IChat['messages']) => state.setSessions(previous => previous.map(session => session.id === id ? { ...session, messages } : session));
    let resolveOldFetch!: (response: { ok: true; body: { getReader: () => ReturnType<typeof makeSseReader> } }) => void;
    let resolveNewFetch!: typeof resolveOldFetch;
    mockAuthFetchFn
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldFetch = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNewFetch = resolve; }));
    let firstSend!: Promise<boolean>;
    let secondSend!: Promise<boolean>;

    try {
      await act(async () => {
        firstSend = result.current.sendMessage('第一次问题', state.getState()[0], 'user-1', updateMessages, state.setSessions);
        await Promise.resolve();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(await firstSend).toBe(false);
      expect(result.current.loading).toBe(false);

      await act(async () => {
        secondSend = result.current.sendMessage('第二次问题', state.getState()[0], 'user-1', updateMessages, state.setSessions);
        await Promise.resolve();
      });
      expect(result.current.loading).toBe(true);
      const pendingMessages = state.getState()[0].messages;

      await act(async () => {
        const staleSession = { ...makeSession(), messages: [
          { role: 'user' as const, content: '第一次问题' },
          { role: 'assistant' as const, content: '过期的旧回答' },
        ] };
        resolveOldFetch({ ok: true, body: { getReader: () => makeSseReader([`data: ${JSON.stringify({ type: 'committed', session: staleSession })}\n\n`]) } });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(state.getState()[0].messages).toEqual(pendingMessages);
      expect(result.current.loading).toBe(true);

      await act(async () => {
        const committed = { ...makeSession(), messages: [
          { role: 'user' as const, content: '第一次问题' },
          { role: 'user' as const, content: '第二次问题' },
          { role: 'assistant' as const, content: '第二次已保存' },
        ] };
        resolveNewFetch({ ok: true, body: { getReader: () => makeSseReader([`data: ${JSON.stringify({ type: 'committed', session: committed })}\n\n`]) } });
        expect(await secondSend).toBe(true);
      });
      expect(state.getState()[0].messages.at(-1)).toEqual({ role: 'assistant', content: '第二次已保存' });
      expect(result.current.loading).toBe(false);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('applies the 180-second total limit even when stream bytes keep arriving', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession({ messages: [] })]);
    let requestSignal!: AbortSignal;
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    const reader = {
      read: vi.fn(() => new Promise<{ done: false; value: Uint8Array }>((resolve, reject) => {
        readTimer = setTimeout(() => resolve({ done: false, value: new TextEncoder().encode(': heartbeat\n\n') }), 30_000);
        requestSignal.addEventListener('abort', () => {
          if (readTimer) clearTimeout(readTimer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      })),
      cancel: vi.fn(async () => {}),
      releaseLock: vi.fn(),
    };
    mockAuthFetchFn.mockImplementation((_url: string, options: RequestInit) => {
      requestSignal = options.signal as AbortSignal;
      return Promise.resolve({ ok: true, body: { getReader: () => reader }, json: async () => ({}) });
    });
    const updateMessages = (id: string, messages: IChat['messages']) => state.setSessions(previous => previous.map(session => session.id === id ? { ...session, messages } : session));
    let sendPromise!: Promise<boolean>;

    try {
      await act(async () => {
        sendPromise = result.current.sendMessage('持续等待的请求', state.getState()[0], 'user-1', updateMessages, state.setSessions);
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toMatch(/超时/);
      expect(await sendPromise).toBe(false);
      expect(state.getState()[0].messages).toEqual([{ role: 'user', content: '持续等待的请求' }]);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('accumulates chunks and updates session on each chunk', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession()]);

    const reader = makeSseReader([
      'data: {"chunk":"你好"}\n\n',
      'data: {"chunk":"世界"}\n\n',
      'data: {"type":"committed","session":{"id":"session-1","_id":"session-1","title":"测试会话","messages":[{"role":"user","content":"你好"},{"role":"user","content":"hi"},{"role":"assistant","content":"你好世界"}]}}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    // updateSessionMessages should be called at least 3 times (initial empty assistant + 2 chunks)
    expect(updateMessages.mock.calls.length).toBeGreaterThanOrEqual(3);
    // setSessions should have been called at least once (after stream completes, plus possibly background)
    expect(setSessions).toHaveBeenCalled();
    // Final state should contain reply
    const finalState = setSessions.mock.results[0]?.value;
    expect(finalState).toBeDefined();
  });

  it('handles committed event and calls replaceSessionId for new session', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession({ id: 'local_temp123' })]);

    const reader = makeSseReader([
      'data: {"chunk":"ok"}\n\n',
      'data: {"type":"committed","session":{"id":"server-generated-id","_id":"server-generated-id","title":"新对话","messages":[{"role":"user","content":"你好"},{"role":"user","content":"hi"},{"role":"assistant","content":"ok"}],"relatedNotes":[]}}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession({ id: 'local_temp123' }),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    expect(mockReplaceSessionId).toHaveBeenCalledWith(
      expect.any(Array),
      'local_temp123',
      'server-generated-id',
    );
  });

  it('skips replaceSessionId when server returns the same id', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession({ id: 'session-1' })]);

    const reader = makeSseReader([
      'data: {"chunk":"ok"}\n\n',
      'data: {"type":"committed","session":{"id":"session-1","_id":"session-1","title":"测试会话","messages":[{"role":"user","content":"你好"},{"role":"user","content":"hi"},{"role":"assistant","content":"ok"}]}}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession({ id: 'session-1' }),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    expect(mockReplaceSessionId).not.toHaveBeenCalled();
  });

  // --- Error handling ---

  it('sets error when HTTP response is not ok', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const setSessions = vi.fn();

    mockAuthFetchFn.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn(async () => ({ error: '请求参数错误' })),
    });

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    expect(result.current.error).toBe('请求参数错误');
    expect(result.current.loading).toBe(false);
  });

  it('sets error when stream contains SSE error', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const setSessions = vi.fn();

    const reader = makeSseReader([
      'data: {"error":"AI 服务暂不可用"}\n\n',
    ]);
    // Only mock the stream call, no background then
    mockAuthFetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
      json: vi.fn(async () => ({})),
    });

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    expect(result.current.error).toBe('AI 服务暂不可用，请稍后重试；你的问题已保留。');
  });

  it('preserves a specific provider failure and adds retry guidance', async () => {
    const { result } = renderHook(() => useChatStream());
    mockAuthFetchSuccess(makeSseReader(['data: {"error":"AI服务连接失败"}\n\n']));

    await act(async () => {
      await result.current.sendMessage('hi', makeSession(), 'user-1', vi.fn(), vi.fn());
    });

    expect(result.current.error).toBe('AI服务连接失败，请重试；你的问题已保留。');
  });

  it('finishes on committed and ignores a trailing error without waiting for reader cancellation', async () => {
    const { result } = renderHook(() => useChatStream());
    const state = makeSetSessionsMock([makeSession()]);
    const committed = { ...makeSession(), messages: [{ role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: '已保存' }] };
    const reader = {
      read: vi.fn(async () => ({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ type: 'committed', session: committed })}\n\ndata: {"error":"late failure"}\n\n`) })),
      cancel: vi.fn(() => new Promise<void>(() => {})),
      releaseLock: vi.fn(),
    };
    mockAuthFetchSuccess(reader);

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.sendMessage('hi', makeSession(), 'user-1', vi.fn(), state.setSessions);
    });

    expect(sent).toBe(true);
    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(false);
    expect(reader.read).toHaveBeenCalledOnce();
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(state.getState()[0].messages).toEqual(committed.messages);
  });

  it('sets error when response body has no ReadableStream', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const setSessions = vi.fn();

    mockAuthFetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
      json: vi.fn(async () => ({})),
    });

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    expect(result.current.error).toBe('无法读取响应流');
  });

  it('handles non-Error throws with fallback message', async () => {
    const { result } = renderHook(() => useChatStream());

    mockAuthFetchFn.mockRejectedValueOnce('网络断开');

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        vi.fn(),
        vi.fn(),
      );
    });

    // instanceof Error check ensures non-Error throws get a fallback, not "undefined"
    expect(result.current.error).toBe('发送失败，请稍后重试');
  });

  it('silences abort errors when request is cancelled', async () => {
    const { result } = renderHook(() => useChatStream());
    const abortError = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
    });

    mockAuthFetchFn.mockRejectedValueOnce(abortError);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        vi.fn(),
        vi.fn(),
      );
    });

    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(false);
  });

  // --- Side effects ---

  it('calls persistChatSessions after stream completes', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession()]);

    const reader = makeSseReader([
      'data: {"type":"committed","session":{"id":"session-1","_id":"session-1","title":"测试会话","messages":[{"role":"user","content":"你好"},{"role":"user","content":"hi"},{"role":"assistant","content":""}]}}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    expect(mockPersistChatSessions).toHaveBeenCalled();
  });

  it('resets loading state and loadingRef after completion', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession()]);

    const reader = makeSseReader([
      'data: {"type":"committed","session":{"id":"session-1","_id":"session-1","title":"测试会话","messages":[{"role":"user","content":"你好"},{"role":"user","content":"hi"},{"role":"assistant","content":""}]}}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        setSessions,
      );
    });

    expect(result.current.loading).toBe(false);

    // Verify another send can proceed (loadingRef was reset)
    mockAuthFetchSuccess(makeSseReader([
      'data: {"type":"committed","session":{"id":"session-1","_id":"session-1","title":"测试会话","messages":[{"role":"user","content":"你好"},{"role":"user","content":"another"},{"role":"assistant","content":""}]}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const updateMessages2 = vi.fn();
    const { setSessions: setSessions2 } = makeSetSessionsMock([makeSession()]);

    await act(async () => {
      await result.current.sendMessage(
        'another',
        makeSession(),
        'user-1',
        updateMessages2,
        setSessions2,
      );
    });

    // Second call should also go through
    expect(updateMessages2).toHaveBeenCalled();
  });
});

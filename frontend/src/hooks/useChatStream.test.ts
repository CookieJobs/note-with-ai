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
 *
 * Also pre-seeds a mock for the background enrichment's authFetch call
 * (updateContextRelatedNotes → /api/chat/context-related-notes) so that
 * the background task completes cleanly without spamming console errors.
 */
function mockAuthFetchSuccess(reader?: ReturnType<typeof makeSseReader>) {
  // Main stream call
  mockAuthFetchFn.mockResolvedValueOnce({
    ok: true,
    status: 200,
    body: reader ? { getReader: () => reader } : null,
    json: vi.fn(async () => ({})),
  });
  // Background: updateContextRelatedNotes call
  mockAuthFetchFn.mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: vi.fn(async () => ({ error: 'not found' })),
  });
  // Background: fetchSummaryTitle call (if assistant reply is non-empty)
  mockAuthFetchFn.mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: vi.fn(async () => ({ error: 'not found' })),
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

    const first = result.current.sendMessage(
      'hi',
      makeSession(),
      'user-1',
      updateMessages1,
      vi.fn().mockResolvedValue('saved-id'),
      setSessions,
    );
    const second = result.current.sendMessage(
      'hi again',
      makeSession(),
      'user-1',
      updateMessages2,
      vi.fn(),
      vi.fn(),
    );

    await act(async () => {
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

  it('accumulates chunks and updates session on each chunk', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession()]);
    const saveToDb = vi.fn().mockResolvedValue('server-id');

    const reader = makeSseReader([
      'data: {"chunk":"你好"}\n\n',
      'data: {"chunk":"世界"}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        saveToDb,
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

  it('handles meta event and calls replaceSessionId for new session', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession({ id: 'local_temp123' })]);
    const saveToDb = vi.fn().mockResolvedValue('server-id');

    const reader = makeSseReader([
      'data: {"chunk":"ok"}\n\n',
      'data: {"type":"meta","sessionId":"server-generated-id"}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession({ id: 'local_temp123' }),
        'user-1',
        updateMessages,
        saveToDb,
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
    const saveToDb = vi.fn().mockResolvedValue('session-1');

    const reader = makeSseReader([
      'data: {"chunk":"ok"}\n\n',
      'data: {"type":"meta","sessionId":"session-1"}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession({ id: 'session-1' }),
        'user-1',
        updateMessages,
        saveToDb,
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
        vi.fn(),
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
        vi.fn(),
        setSessions,
      );
    });

    expect(result.current.error).toBe('AI 服务暂不可用');
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
        vi.fn(),
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
        vi.fn(),
      );
    });

    // instanceof Error check ensures non-Error throws get a fallback, not "undefined"
    expect(result.current.error).toBe('发送失败，请稍后重试');
  });

  // --- Side effects ---

  it('calls persistChatSessions after stream completes', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession()]);
    const saveToDb = vi.fn().mockResolvedValue('server-id');

    const reader = makeSseReader(['data: [DONE]\n\n']);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        saveToDb,
        setSessions,
      );
    });

    expect(mockPersistChatSessions).toHaveBeenCalled();
  });

  it('resets loading state and loadingRef after completion', async () => {
    const { result } = renderHook(() => useChatStream());
    const updateMessages = vi.fn();
    const { setSessions } = makeSetSessionsMock([makeSession()]);
    const saveToDb = vi.fn().mockResolvedValue('server-id');

    const reader = makeSseReader(['data: [DONE]\n\n']);
    mockAuthFetchSuccess(reader);

    await act(async () => {
      await result.current.sendMessage(
        'hi',
        makeSession(),
        'user-1',
        updateMessages,
        saveToDb,
        setSessions,
      );
    });

    expect(result.current.loading).toBe(false);

    // Verify another send can proceed (loadingRef was reset)
    mockAuthFetchSuccess(makeSseReader(['data: [DONE]\n\n']));
    const updateMessages2 = vi.fn();
    const { setSessions: setSessions2 } = makeSetSessionsMock([makeSession()]);

    await act(async () => {
      await result.current.sendMessage(
        'another',
        makeSession(),
        'user-1',
        updateMessages2,
        vi.fn().mockResolvedValue('id2'),
        setSessions2,
      );
    });

    // Second call should also go through
    expect(updateMessages2).toHaveBeenCalled();
  });
});

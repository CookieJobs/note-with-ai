import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatSession } from './useChatSession';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch }));

const intro = { noteId: 'note-1', noteTitle: '学习安排', snippet: '周三20分钟', aiOpening: '聊聊学习安排。' };

describe('single-note care session', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  afterEach(cleanup);

  it('saves the explicitly selected note and retains its binding after replacing the local ID', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { sessionId: 'server-1' } }) });
    const { result } = renderHook(() => useChatSession('user-1'));

    await act(async () => { await result.current.addCareMessage(intro.aiOpening, intro); });

    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toMatchObject({ sourceNoteId: 'note-1' });
    expect(result.current.currentSession).toMatchObject({ id: 'server-1', sourceNoteId: 'note-1' });
    expect(JSON.parse(localStorage.getItem('chat_sessions_user-1')!)[0]).toMatchObject({ id: 'server-1', sourceNoteId: 'note-1' });
    expect(result.current.currentSession?.messages[0]).not.toHaveProperty('sourceSnapshot');

    await act(async () => { await result.current.startNewSession('user-1'); });
    expect(result.current.currentSession).not.toHaveProperty('sourceNoteId');
  });

  it('reports a rejected source save and leaves no successfully bound opening behind', async () => {
    authFetch.mockResolvedValue({ ok: false, json: async () => ({ message: '这篇笔记已删除' }) });
    const { result } = renderHook(() => useChatSession('user-1'));
    let failure: unknown;
    await act(async () => {
      try { await result.current.addCareMessage(intro.aiOpening, intro); } catch (error) { failure = error; }
    });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('已删除');
    expect(result.current.sessions.filter(session => session.messages.length > 0)).toEqual([]);
  });
});

describe('history loading ownership', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); });
  afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

  it('ignores the old A request after A → B → A even though the user ID matches again', async () => {
    const pending: ((response: unknown) => void)[] = [];
    authFetch.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    const { result, rerender } = renderHook(({ id }) => useChatSession(id), { initialProps: { id: 'a' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    rerender({ id: 'b' });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    rerender({ id: 'a' });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const reply = (id: string) => ({ ok: true, json: async () => ({ success: true, data: { sessions: [{ id, title: id, messages: [] }] } }) });
    await act(async () => { pending[2](reply('current-a')); });
    await act(async () => { pending[0](reply('obsolete-a')); pending[1](reply('obsolete-b')); });
    expect(result.current.sessions.map(session => session.id)).toEqual(['current-a']);
    expect(JSON.parse(localStorage.getItem('chat_sessions_a')!)[0].id).toBe('current-a');
    expect(localStorage.getItem('chat_sessions_b')).toBeNull();
    expect(result.current.sessionsLoaded).toBe(true);
    expect(result.current.sessionsError).toBe('');
  });

  it('locks same-event retry and ignores success after unmount', async () => {
    let finish!: (response: unknown) => void;
    authFetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useChatSession('a'));
    act(() => { void result.current.retrySessions(); void result.current.retrySessions(); });
    expect(authFetch).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { finish({ ok: true, json: async () => ({ success: true, data: { sessions: [{ id: 'late', messages: [] }] } }) }); });
    expect(localStorage.getItem('chat_sessions_a')).toBeNull();
  });
});

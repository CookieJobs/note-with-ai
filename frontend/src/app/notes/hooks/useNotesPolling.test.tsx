import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from './useNotes';
import { useNotes } from './useNotes';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('../../../utils/auth', () => ({ authFetch }));

const baseNote: Note = {
  _id: 'note-1',
  title: '正文',
  content: '正文',
  contentText: '正文',
  contentJson: null,
  summary: '',
  concepts: [],
  keywords: [],
  recommendCache: null,
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'pending' },
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

function makeHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function listResponse(notes: Note[]) {
  return { ok: true, json: async () => ({ success: true, data: { notes } }) };
}

function setVisible(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

describe('useNotes pending enrichment polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setVisible('visible');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits five seconds then coalesces all pending Notes into one list refetch', async () => {
    authFetch.mockResolvedValue(listResponse([baseNote, { ...baseNote, _id: 'note-2' }]));
    const { queryClient, wrapper } = makeHarness();
    const { unmount } = renderHook(() => useNotes(null), { wrapper });

    act(() => {
      queryClient.setQueryData<Note[]>(['notes'], [baseNote, { ...baseNote, _id: 'note-2' }]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(authFetch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith('/api/notes', expect.objectContaining({ signal: expect.anything() }));
    unmount();
  });

  it('stops observing a pending revision when the list refetch returns a terminal status', async () => {
    const readyNote: Note = { ...baseNote, enrichment: { sourceRevision: 4, status: 'ready' } };
    authFetch.mockResolvedValue(listResponse([readyNote]));
    const { queryClient, wrapper } = makeHarness();
    const { unmount } = renderHook(() => useNotes(null), { wrapper });
    act(() => queryClient.setQueryData<Note[]>(['notes'], [baseNote]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(authFetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not spend polling attempts while hidden and resumes after visibility returns', async () => {
    authFetch.mockResolvedValue(listResponse([baseNote]));
    const { queryClient, wrapper } = makeHarness();
    const { unmount } = renderHook(() => useNotes(null), { wrapper });
    setVisible('hidden');
    act(() => queryClient.setQueryData<Note[]>(['notes'], [baseNote]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(authFetch).not.toHaveBeenCalled();

    setVisible('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(authFetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('also pauses while unfocused and resumes the remaining work on focus', async () => {
    authFetch.mockResolvedValue(listResponse([baseNote]));
    const { queryClient, wrapper } = makeHarness();
    const { unmount } = renderHook(() => useNotes(null), { wrapper });
    vi.mocked(document.hasFocus).mockReturnValue(false);
    act(() => queryClient.setQueryData<Note[]>(['notes'], [baseNote]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(authFetch).not.toHaveBeenCalled();

    vi.mocked(document.hasFocus).mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(authFetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not spend a new pending revision attempt before that revision has been observed for five seconds', async () => {
    const secondPending: Note = { ...baseNote, _id: 'note-2' };
    authFetch.mockResolvedValue(listResponse([baseNote, secondPending]));
    const { queryClient, wrapper } = makeHarness();
    const { unmount } = renderHook(() => useNotes(null), { wrapper });

    act(() => queryClient.setQueryData<Note[]>(['notes'], [baseNote]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    act(() => queryClient.setQueryData<Note[]>(['notes'], [baseNote, secondPending]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(authFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499);
    });
    expect(authFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(authFetch).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('retires an old pending revision and gives the advanced revision its own bounded attempts', async () => {
    const advancedPending: Note = {
      ...baseNote,
      revision: 5,
      enrichment: { sourceRevision: 5, status: 'pending' },
    };
    authFetch
      .mockResolvedValueOnce(listResponse([advancedPending]))
      .mockResolvedValue(listResponse([advancedPending]));
    const { queryClient, wrapper } = makeHarness();
    const { unmount } = renderHook(() => useNotes(null), { wrapper });
    act(() => queryClient.setQueryData<Note[]>(['notes'], [baseNote]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(authFetch).toHaveBeenCalledTimes(6);
    unmount();
  });

  it('caps a permanently pending revision at five list refetch attempts and clears work on unmount', async () => {
    authFetch.mockResolvedValue(listResponse([baseNote]));
    const { queryClient, wrapper } = makeHarness();
    const { unmount } = renderHook(() => useNotes(null), { wrapper });
    act(() => queryClient.setQueryData<Note[]>(['notes'], [baseNote]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(authFetch).toHaveBeenCalledTimes(5);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(authFetch).toHaveBeenCalledTimes(5);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from './useNotes';
import { NoteWriteConflict, useNotes } from './useNotes';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('../../../utils/auth', () => ({ authFetch }));

const staleNote: Note = {
  _id: 'note-1',
  title: '旧标题',
  content: '旧正文',
  contentText: '旧正文',
  contentJson: null,
  summary: '旧摘要',
  concepts: ['旧概念'],
  keywords: ['旧关键词'],
  recommendCache: {
    sourceRevision: 4,
    byCandidateId: {},
  },
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

const canonicalNote = {
  ...staleNote,
  title: '服务端标题',
  summary: '服务端摘要',
  concepts: ['服务端概念'],
  keywords: ['服务端关键词'],
  recommendCache: null,
  revision: 5,
  updatedAt: '2026-08-19T00:01:00.000Z',
  futureCanonicalField: 'must-survive',
};

const canonicalEnrichment = { sourceRevision: 5, status: 'pending' as const };

const newerCanonicalNote: Note = {
  ...canonicalNote,
  title: '更新的服务端标题',
  revision: 6,
  recommendCache: { sourceRevision: 6, byCandidateId: {} },
  enrichment: { sourceRevision: 6, status: 'ready' },
  updatedAt: '2026-08-19T00:02:00.000Z',
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function canonicalResponse(note: Note, enrichment = note.enrichment) {
  return {
    ok: true,
    json: async () => ({ success: true, data: { note, enrichment } }),
  };
}

const user = { _id: 'user-1' } as never;

describe('useNotes canonical writes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces a cached Note with the complete canonical PATCH snapshot', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { note: canonicalNote, enrichment: canonicalEnrichment },
      }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await act(async () => {
      await result.current.updateNote({
        noteId: 'note-1',
        expectedRevision: 4,
        changes: { title: '新标题' },
      });
    });

    expect(authFetch).toHaveBeenCalledTimes(1);
    const request = authFetch.mock.calls[0][1] as RequestInit;
    expect(authFetch).toHaveBeenCalledWith('/api/notes/note-1', expect.objectContaining({ method: 'PATCH' }));
    expect(JSON.parse(String(request.body))).toEqual({
      expectedRevision: 4,
      changes: { title: '新标题' },
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual({
      ...canonicalNote,
      enrichment: canonicalEnrichment,
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0].recommendCache).toBeNull();
  });

  it('applies a valid 409 current snapshot before throwing a typed conflict', async () => {
    authFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'NOTE_WRITE_CONFLICT',
        current: { note: canonicalNote, enrichment: canonicalEnrichment },
      }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.updateNote({
          noteId: 'note-1',
          expectedRevision: 4,
          changes: { title: '新标题' },
        });
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(NoteWriteConflict);
    expect((thrown as NoteWriteConflict).current).toEqual({
      ...canonicalNote,
      enrichment: canonicalEnrichment,
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0].revision).toBe(5);
  });

  it('does not mutate shared cache when a 409 current snapshot is malformed', async () => {
    authFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'NOTE_WRITE_CONFLICT',
        current: { note: { _id: 'note-1', revision: 5 } },
      }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' },
    })).rejects.toThrow('笔记写入响应无效');

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(staleNote);
  });

  it('rejects malformed write payloads without changing the cached Note', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { note: { _id: 'note-1', revision: 5 } } }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({
      noteId: 'note-1',
      expectedRevision: 4,
      changes: { title: '新标题' },
    })).rejects.toThrow('笔记写入响应无效');

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(staleNote);
  });

  it('rejects an HTTP 200 write body that is not a successful canonical envelope', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        data: { note: canonicalNote, enrichment: canonicalEnrichment },
      }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' },
    })).rejects.toThrow('笔记写入响应无效');

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(staleNote);
  });

  it('rejects a write snapshot whose enrichment revision does not exactly match its Note revision', async () => {
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote, { sourceRevision: 4, status: 'pending' }));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' },
    })).rejects.toThrow('笔记写入响应无效');

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(staleNote);
  });

  it('rejects a 409 current snapshot with a non-positive or fractional enrichment revision', async () => {
    authFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'NOTE_WRITE_CONFLICT',
        current: { note: canonicalNote, enrichment: { sourceRevision: 5.5, status: 'pending' } },
      }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' },
    })).rejects.toThrow('笔记写入响应无效');

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(staleNote);
  });

  it('keeps and returns a newer cached canonical Note when a delayed success carries an older revision', async () => {
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote, canonicalEnrichment));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [newerCanonicalNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let returned!: Note;
    await act(async () => {
      returned = await result.current.updateNote({
        noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟标题' },
      });
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(newerCanonicalNote);
    expect(returned).toEqual(newerCanonicalNote);
  });

  it('throws a conflict with the newer cached canonical Note when a delayed 409 current is older', async () => {
    authFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'NOTE_WRITE_CONFLICT',
        current: { note: canonicalNote, enrichment: canonicalEnrichment },
      }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [newerCanonicalNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟标题' },
    })).rejects.toMatchObject({ current: newerCanonicalNote });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(newerCanonicalNote);
  });

  it('does not let an older delayed write response overwrite a newer concurrent canonical write', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    authFetch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let firstWrite!: Promise<Note>;
    let secondWrite!: Promise<Note>;
    act(() => {
      firstWrite = result.current.updateNote({
        noteId: 'note-1', expectedRevision: 4, changes: { title: '写入 A' },
      });
      secondWrite = result.current.updateNote({
        noteId: 'note-1', expectedRevision: 5, changes: { title: '写入 B' },
      });
    });

    await act(async () => {
      second.resolve(canonicalResponse(newerCanonicalNote));
      await secondWrite;
    });
    await act(async () => {
      first.resolve(canonicalResponse(canonicalNote, canonicalEnrichment));
      await firstWrite;
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(newerCanonicalNote);
    await expect(firstWrite).resolves.toEqual(newerCanonicalNote);
  });

  it('does not let a same-revision pending write snapshot replace an observed ready canonical snapshot', async () => {
    const readyAtRevisionFive: Note = {
      ...canonicalNote,
      enrichment: { sourceRevision: 5, status: 'ready' },
      recommendCache: { sourceRevision: 5, byCandidateId: {} },
    };
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote, canonicalEnrichment));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [readyAtRevisionFive]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    const returned = await result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟标题' },
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(readyAtRevisionFive);
    expect(returned).toEqual(readyAtRevisionFive);
  });

  it('keeps the cached full snapshot on a same-revision ready success tie', async () => {
    const cachedReady: Note = {
      ...canonicalNote,
      enrichment: { sourceRevision: 5, status: 'ready' },
      recommendCache: { sourceRevision: 5, generatedAt: '2026-08-19T00:03:00.000Z', byCandidateId: {} },
    };
    const delayedReady: Note = { ...cachedReady, recommendCache: null };
    authFetch.mockResolvedValue(canonicalResponse(delayedReady));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [cachedReady]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    const returned = await result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟标题' },
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(cachedReady);
    expect(returned).toEqual(cachedReady);
  });

  it('keeps the cached full snapshot in a same-revision ready 409 tie', async () => {
    const cachedReady: Note = {
      ...canonicalNote,
      enrichment: { sourceRevision: 5, status: 'ready' },
      recommendCache: { sourceRevision: 5, generatedAt: '2026-08-19T00:03:00.000Z', byCandidateId: {} },
    };
    const delayedReady: Note = { ...cachedReady, recommendCache: null };
    authFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'NOTE_WRITE_CONFLICT', current: { note: delayedReady, enrichment: delayedReady.enrichment } }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [cachedReady]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟标题' },
    })).rejects.toMatchObject({ current: cachedReady });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(cachedReady);
  });

  it('accepts a strictly higher same-revision enrichment progress as its complete canonical snapshot', async () => {
    const cachedPending: Note = {
      ...canonicalNote,
      enrichment: { sourceRevision: 5, status: 'pending' },
      recommendCache: null,
    };
    const incomingReady: Note = {
      ...cachedPending,
      enrichment: { sourceRevision: 5, status: 'ready' },
      recommendCache: { sourceRevision: 5, byCandidateId: {} },
    };
    authFetch.mockResolvedValue(canonicalResponse(incomingReady));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [cachedPending]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    const returned = await result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟标题' },
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(incomingReady);
    expect(returned).toEqual(incomingReady);
  });

  it('fills a legacy same-revision cached Note that lacks enrichment from a validated canonical snapshot', async () => {
    const legacyCached: Note = {
      ...canonicalNote,
      enrichment: undefined,
      recommendCache: { sourceRevision: 5, byCandidateId: {} },
    };
    const incomingPending: Note = {
      ...canonicalNote,
      enrichment: { sourceRevision: 5, status: 'pending' },
      recommendCache: null,
    };
    authFetch.mockResolvedValue(canonicalResponse(incomingPending));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [legacyCached]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    const returned = await result.current.updateNote({
      noteId: 'note-1', expectedRevision: 4, changes: { title: '兼容旧数据' },
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(incomingPending);
    expect(returned).toEqual(incomingPending);
  });
});

describe('useNotes optimistic create and delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces only its optimistic Note with the canonical create snapshot', async () => {
    let resolveRequest: (response: unknown) => void = () => undefined;
    authFetch.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let createPromise: Promise<Note> | undefined;
    act(() => {
      createPromise = result.current.createNote({
        body: { kind: 'plain-text', text: '新建正文' },
        optimistic: { contentText: '新建正文', contentJson: null },
      });
    });

    const temporary = queryClient.getQueryData<Note[]>(['notes'])?.[0];
    expect(temporary).toEqual(expect.objectContaining({
      _id: expect.stringMatching(/^temp-/),
      contentText: '新建正文',
      revision: 0,
      enrichment: { sourceRevision: 0, status: 'pending' },
    }));

    await act(async () => {
      resolveRequest({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            note: { ...canonicalNote, _id: 'created-note', content: '新建正文', contentText: '新建正文', revision: 1 },
            enrichment: { sourceRevision: 1, status: 'pending' },
          },
        }),
      });
      await createPromise;
    });

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith('/api/notes', expect.objectContaining({ method: 'POST' }));
    expect(queryClient.getQueryData<Note[]>(['notes'])?.map((note) => note._id)).toEqual(['created-note', 'note-1']);
  });

  it('keeps a newer canonical Note already hydrated by GET when the delayed create response has the same id at an older revision', async () => {
    const post = deferred<unknown>();
    authFetch.mockImplementation(() => post.promise);
    const delayedCreate: Note = {
      ...canonicalNote,
      _id: 'created-note',
      revision: 1,
      enrichment: { sourceRevision: 1, status: 'pending' },
    };
    const hydratedCreate: Note = {
      ...newerCanonicalNote,
      _id: 'created-note',
      revision: 2,
      enrichment: { sourceRevision: 2, status: 'ready' },
      recommendCache: { sourceRevision: 2, byCandidateId: {} },
    };
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let createPromise!: Promise<Note>;
    act(() => {
      createPromise = result.current.createNote({
        body: { kind: 'plain-text', text: '新建正文' },
        optimistic: { contentText: '新建正文', contentJson: null },
      });
    });
    act(() => queryClient.setQueryData<Note[]>(['notes'], [hydratedCreate]));

    await act(async () => {
      post.resolve(canonicalResponse(delayedCreate));
      await createPromise;
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])).toEqual([hydratedCreate]);
    await expect(createPromise).resolves.toEqual(hydratedCreate);
  });

  it('keeps a hydrated ready snapshot on a same-revision delayed create tie', async () => {
    const post = deferred<unknown>();
    authFetch.mockImplementation(() => post.promise);
    const delayedCreate: Note = {
      ...canonicalNote,
      _id: 'created-note',
      revision: 1,
      enrichment: { sourceRevision: 1, status: 'ready' },
      recommendCache: null,
    };
    const hydratedCreate: Note = {
      ...delayedCreate,
      recommendCache: { sourceRevision: 1, generatedAt: '2026-08-19T00:03:00.000Z', byCandidateId: {} },
    };
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let createPromise!: Promise<Note>;
    act(() => {
      createPromise = result.current.createNote({
        body: { kind: 'plain-text', text: '新建正文' },
        optimistic: { contentText: '新建正文', contentJson: null },
      });
    });
    act(() => queryClient.setQueryData<Note[]>(['notes'], [hydratedCreate]));

    await act(async () => {
      post.resolve(canonicalResponse(delayedCreate));
      await createPromise;
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])).toEqual([hydratedCreate]);
    await expect(createPromise).resolves.toEqual(hydratedCreate);
  });

  it('removes only its failed optimistic Note without restoring a stale list snapshot', async () => {
    let resolveRequest: (response: unknown) => void = () => undefined;
    authFetch.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let createPromise: Promise<Note> | undefined;
    act(() => {
      createPromise = result.current.createNote({
        body: { kind: 'plain-text', text: '会失败的正文' },
        optimistic: { contentText: '会失败的正文', contentJson: null },
      });
    });
    const concurrentNote: Note = { ...staleNote, _id: 'concurrent-note', revision: 8 };
    act(() => {
      queryClient.setQueryData<Note[]>(['notes'], (notes = []) => [concurrentNote, ...notes]);
    });

    await act(async () => {
      resolveRequest({
        ok: false,
        status: 500,
        json: async () => ({ message: '创建失败' }),
      });
      await expect(createPromise).rejects.toThrow('创建失败');
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.map((note) => note._id)).toEqual(['concurrent-note', 'note-1']);
  });

  it('removes only a successfully deleted Note and preserves the cache on delete failure', async () => {
    const { queryClient, wrapper } = makeHarness();
    const otherNote: Note = { ...staleNote, _id: 'note-2' };
    queryClient.setQueryData<Note[]>(['notes'], [staleNote, otherNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });
    authFetch.mockResolvedValueOnce({ ok: true });

    await act(async () => {
      await result.current.deleteNote('note-1');
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.map((note) => note._id)).toEqual(['note-2']);

    authFetch.mockResolvedValueOnce({ ok: false });
    await expect(result.current.deleteNote('note-2')).rejects.toThrow('删除失败');
    expect(queryClient.getQueryData<Note[]>(['notes'])?.map((note) => note._id)).toEqual(['note-2']);
  });

  it('hydrates the complete canonical Note list returned by GET', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { notes: [canonicalNote] } }),
    });
    const { queryClient, wrapper } = makeHarness();
    renderHook(() => useNotes(user), { wrapper });

    await waitFor(() => expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(canonicalNote));
  });

  it('keeps an optimistic temporary Note through a crossing GET and inserts its canonical create response once', async () => {
    const post = deferred<unknown>();
    const list = deferred<unknown>();
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/notes') {
        return authFetch.mock.calls.filter(([calledUrl]) => calledUrl === '/api/notes').length === 1
          ? post.promise
          : list.promise;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let createPromise!: Promise<Note>;
    let refetchPromise!: Promise<unknown>;
    act(() => {
      createPromise = result.current.createNote({
        body: { kind: 'plain-text', text: '新建正文' },
        optimistic: { contentText: '新建正文', contentJson: null },
      });
      refetchPromise = result.current.refetchNotes();
    });
    await act(async () => {
      list.resolve({ ok: true, json: async () => ({ success: true, data: { notes: [staleNote] } }) });
      await refetchPromise;
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]._id).toMatch(/^temp-/);

    await act(async () => {
      post.resolve(canonicalResponse({ ...canonicalNote, _id: 'created-note', revision: 1, enrichment: { sourceRevision: 1, status: 'pending' } }));
      await createPromise;
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.map((note) => note._id)).toEqual(['created-note', 'note-1']);
  });
});

describe('useNotes recommendation refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only the recommendation cache for the captured Note revision', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          meta: { algoVersion: 'semantic-notes-v3' },
          recommendations: [{
            note: { _id: 'candidate-1', updatedAt: '2026-08-19T00:01:00.000Z' },
            s1: 0.8,
            s2: 0.9,
            type: '强关联',
            reason: '相似主题',
          }],
        },
      }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await act(async () => {
      await result.current.refreshRecommendCache('note-1');
    });

    expect(authFetch).toHaveBeenCalledWith('/api/recommend/semantic-notes', expect.objectContaining({ method: 'POST' }));
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(expect.objectContaining({
      ...staleNote,
      recommendCache: expect.objectContaining({ sourceRevision: 4 }),
    }));
  });

  it('discards a late recommendation response after the Note revision advances', async () => {
    let resolveRequest: (response: unknown) => void = () => undefined;
    authFetch.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refreshRecommendCache('note-1');
    });
    const advanced: Note = { ...canonicalNote, enrichment: canonicalEnrichment };
    act(() => queryClient.setQueryData<Note[]>(['notes'], [advanced]));

    await act(async () => {
      resolveRequest({
        ok: true,
        json: async () => ({ success: true, data: { meta: {}, recommendations: [] } }),
      });
      await refreshPromise;
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(advanced);
  });

  it.each([
    { success: false, data: { recommendations: [] } },
    { success: true, data: { recommendations: 'not-an-array' } },
  ])('rejects malformed successful recommendation responses without caching an empty result', async (payload) => {
    authFetch.mockResolvedValue({ ok: true, json: async () => payload });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.refreshRecommendCache('note-1')).rejects.toThrow('推荐响应无效');
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual(staleNote);
  });
});

describe('useNotes list and write races', () => {
  beforeEach(() => vi.clearAllMocks());

  function prepareCrossingList() {
    const list = deferred<unknown>();
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [staleNote]);
    const hook = renderHook(() => useNotes(null), { wrapper });
    return { list, queryClient, ...hook };
  }

  it('does not let a late GET overwrite a successful canonical update', async () => {
    const patch = deferred<unknown>();
    const { list, queryClient, result } = prepareCrossingList();
    authFetch.mockImplementation((url: string) => url === '/api/notes'
      ? list.promise
      : patch.promise);

    let refetch!: Promise<unknown>;
    let update!: Promise<Note>;
    act(() => {
      refetch = result.current.refetchNotes();
      update = result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } });
    });
    await act(async () => {
      patch.resolve(canonicalResponse(canonicalNote, canonicalEnrichment));
      await update;
      list.resolve({ ok: true, json: async () => ({ success: true, data: { notes: [staleNote] } }) });
      await refetch;
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual({ ...canonicalNote, enrichment: canonicalEnrichment });
  });

  it('does not let a late GET overwrite a 409 current snapshot', async () => {
    const patch = deferred<unknown>();
    const { list, queryClient, result } = prepareCrossingList();
    authFetch.mockImplementation((url: string) => url === '/api/notes' ? list.promise : patch.promise);
    let refetch!: Promise<unknown>;
    let update!: Promise<Note>;
    act(() => {
      refetch = result.current.refetchNotes();
      update = result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } });
    });
    await act(async () => {
      patch.resolve({ ok: false, status: 409, json: async () => ({ code: 'NOTE_WRITE_CONFLICT', current: { note: canonicalNote, enrichment: canonicalEnrichment } }) });
      await expect(update).rejects.toBeInstanceOf(NoteWriteConflict);
      list.resolve({ ok: true, json: async () => ({ success: true, data: { notes: [staleNote] } }) });
      await refetch;
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0].revision).toBe(5);
  });

  it('does not let a late GET resurrect a successfully deleted Note', async () => {
    const deletion = deferred<unknown>();
    const { list, queryClient, result } = prepareCrossingList();
    authFetch.mockImplementation((url: string) => url === '/api/notes' ? list.promise : deletion.promise);
    let refetch!: Promise<unknown>;
    let remove!: Promise<unknown>;
    act(() => {
      refetch = result.current.refetchNotes();
      remove = result.current.deleteNote('note-1');
    });
    await act(async () => {
      deletion.resolve({ ok: true });
      await remove;
      list.resolve({ ok: true, json: async () => ({ success: true, data: { notes: [staleNote] } }) });
      await refetch;
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])).toEqual([]);
  });

  it('does not let a late GET erase a refreshed recommendation cache', async () => {
    const recommendation = deferred<unknown>();
    const { list, queryClient, result } = prepareCrossingList();
    authFetch.mockImplementation((url: string) => url === '/api/notes'
      ? list.promise
      : recommendation.promise);
    let refetch!: Promise<unknown>;
    let refresh!: Promise<void>;
    act(() => {
      refetch = result.current.refetchNotes();
      refresh = result.current.refreshRecommendCache('note-1');
    });
    await act(async () => {
      recommendation.resolve({ ok: true, json: async () => ({ success: true, data: { meta: {}, recommendations: [] } }) });
      await refresh;
      list.resolve({ ok: true, json: async () => ({ success: true, data: { notes: [staleNote] } }) });
      await refetch;
    });
    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0].recommendCache).toEqual(expect.objectContaining({ sourceRevision: 4 }));
  });

  it('accepts a same-revision GET enrichment transition from pending to ready', async () => {
    const ready = { ...staleNote, enrichment: { sourceRevision: 4, status: 'ready' as const } };
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { notes: [ready] } }),
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<Note[]>(['notes'], [{ ...staleNote, enrichment: { sourceRevision: 4, status: 'pending' } }]);
    renderHook(() => useNotes(user), { wrapper });

    await waitFor(() => expect(queryClient.getQueryData<Note[]>(['notes'])?.[0].enrichment?.status).toBe('ready'));
  });
});

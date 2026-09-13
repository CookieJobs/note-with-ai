import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenNotePages, type NotePages } from './notePages';
import { NoteWriteConflict, type Note, useNotes } from './useNotes';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../../../utils/auth', () => ({ authFetch }));

const staleNote: Note = {
  _id: 'note-1', title: '旧标题', content: '旧正文', contentText: '旧正文', contentJson: null,
  summary: '旧摘要', concepts: ['旧概念'], keywords: ['旧关键词'], recommendCache: null, revision: 4,
  enrichment: { sourceRevision: 4, status: 'pending' },
  createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
};
const canonicalNote = {
  ...staleNote, title: '服务端标题', revision: 5, enrichment: { sourceRevision: 5, status: 'ready' },
  updatedAt: '2026-08-19T00:01:00.000Z', futureCanonicalField: 'must-survive',
} as Note & { futureCanonicalField: string };
const user = { _id: 'user-1' } as never;

function makeHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

function pages(notes: Note[], pageInfo = { hasNextPage: false, nextCursor: null }): NotePages {
  return { pages: [{ notes, pageInfo }], pageParams: [undefined] };
}

function pageResponse(notes: Note[], pageInfo = { hasNextPage: false, nextCursor: null }) {
  return { ok: true, json: async () => ({ success: true, data: { notes, pageInfo } }) };
}

function canonicalResponse(note: Note, enrichment = note.enrichment) {
  return { ok: true, json: async () => ({ success: true, data: { note, enrichment } }) };
}

function cachedNotes(queryClient: QueryClient) {
  return flattenNotePages(queryClient.getQueryData<NotePages>(['notes']));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function recommendationResponse() {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { meta: {}, recommendations: [] },
    }),
  };
}

describe('useNotes cursor pages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the first page and explicitly fetches the next cursor once', async () => {
    authFetch.mockImplementation((url: string) => (
      url === '/api/notes?limit=30'
        ? pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' })
        : pageResponse([canonicalNote])
    ));
    const { wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(user), { wrapper });

    await waitFor(() => expect(result.current.notes).toEqual([staleNote]));
    await act(async () => { await result.current.loadMore(); });

    await waitFor(() => expect(result.current.notes.map((note) => note._id)).toEqual(['note-1']));
    expect(authFetch).toHaveBeenCalledWith('/api/notes?limit=30&cursor=cursor-2', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('does not make a request when no next cursor exists', async () => {
    authFetch.mockResolvedValue(pageResponse([staleNote]));
    const { wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(result.current.notes).toEqual([staleNote]));
    await act(async () => { await result.current.loadMore(); });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('retains loaded pages when the next page fails', async () => {
    authFetch.mockImplementation((url: string) => (
      url === '/api/notes?limit=30'
        ? pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' })
        : { ok: false, status: 503, json: async () => ({}) }
    ));
    const { wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(result.current.notes).toEqual([staleNote]));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.notes).toEqual([staleNote]);
    expect(result.current.hasNextPage).toBe(true);
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
  });
});

describe('useNotes mutations over infinite pages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces a cached Note with a complete canonical PATCH snapshot', async () => {
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await act(async () => { await result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } }); });
    expect(cachedNotes(queryClient)).toEqual([canonicalNote]);
  });

  it('commits a valid 409 snapshot before throwing a typed conflict', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'NOTE_WRITE_CONFLICT', current: { note: canonicalNote, enrichment: canonicalNote.enrichment } }) });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } })).rejects.toBeInstanceOf(NoteWriteConflict);
    expect(cachedNotes(queryClient)).toEqual([canonicalNote]);
  });

  it('replaces its optimistic create in page one with the canonical snapshot', async () => {
    const created: Note = { ...canonicalNote, _id: 'created-note', revision: 1, enrichment: { sourceRevision: 1, status: 'pending' } };
    authFetch.mockResolvedValue(canonicalResponse(created));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await act(async () => { await result.current.createNote({ body: { kind: 'plain-text', text: '内容' }, optimistic: { contentText: '内容' } }); });
    expect(cachedNotes(queryClient).map((note) => note._id)).toEqual(['created-note', 'note-1']);
  });

  it('rolls back only a failed optimistic note while preserving concurrent cached notes', async () => {
    let reject!: (reason: Error) => void;
    authFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return new Promise((_, rejectPromise) => { reject = rejectPromise; });
      throw new Error(`unexpected ${url}`);
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    let create!: Promise<Note>;
    act(() => { create = result.current.createNote({ body: { kind: 'plain-text', text: '内容' }, optimistic: { contentText: '内容' } }); });
    await waitFor(() => expect(cachedNotes(queryClient)[0]._id).toMatch(/^temp-/));
    act(() => queryClient.setQueryData<NotePages>(['notes'], pages([{ ...staleNote, _id: 'concurrent-note' }, ...cachedNotes(queryClient)])));
    await act(async () => { reject(new Error('offline')); await expect(create).rejects.toThrow('offline'); });
    expect(cachedNotes(queryClient).map((note) => note._id)).toEqual(['concurrent-note', 'note-1']);
  });

  it('keeps an optimistic note through a crossing first-page GET and inserts its canonical response once', async () => {
    const list = deferred<ReturnType<typeof pageResponse>>();
    const post = deferred<ReturnType<typeof canonicalResponse>>();
    authFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/notes?limit=30') return list.promise;
      if (options?.method === 'POST') return post.promise;
      throw new Error(`unexpected request: ${url}`);
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(user), { wrapper });

    let create!: Promise<Note>;
    act(() => {
      create = result.current.createNote({ body: { kind: 'plain-text', text: '内容' }, optimistic: { contentText: '内容' } });
    });
    await waitFor(() => expect(cachedNotes(queryClient)[0]._id).toMatch(/^temp-/));
    await act(async () => { list.resolve(pageResponse([staleNote])); });
    expect(cachedNotes(queryClient)[0]._id).toMatch(/^temp-/);

    const created: Note = { ...canonicalNote, _id: 'created-note', revision: 1, enrichment: { sourceRevision: 1, status: 'pending' } };
    await act(async () => { post.resolve(canonicalResponse(created)); await create; });
    expect(cachedNotes(queryClient).map((note) => note._id)).toEqual(['created-note', 'note-1']);
  });

  it('removes a successful deletion from every loaded page and keeps data after a failure', async () => {
    const second = { ...staleNote, _id: 'note-2' };
    authFetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], { pages: [
      { notes: [staleNote], pageInfo: { hasNextPage: true, nextCursor: 'cursor-2' } },
      { notes: [second], pageInfo: { hasNextPage: false, nextCursor: null } },
    ], pageParams: [undefined, 'cursor-2'] });
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await act(async () => { await result.current.deleteNote('note-2'); });
    await expect(result.current.deleteNote('note-1')).rejects.toThrow('删除失败');
    expect(cachedNotes(queryClient).map((note) => note._id)).toEqual(['note-1']);
  });
});

describe('useNotes stale list protection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not let a late first-page GET overwrite a newer canonical update', async () => {
    let resolveList!: (value: ReturnType<typeof pageResponse>) => void;
    const pendingList = new Promise<ReturnType<typeof pageResponse>>((resolve) => { resolveList = resolve; });
    authFetch.mockImplementation((url: string) => url === '/api/notes?limit=30' ? pendingList : canonicalResponse(canonicalNote));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await act(async () => { await result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } }); });
    await act(async () => { resolveList(pageResponse([staleNote])); });
    expect(cachedNotes(queryClient)).toEqual([canonicalNote]);
  });

  it('does not let a late GET resurrect a deleted note from an earlier page generation', async () => {
    const pendingList = deferred<ReturnType<typeof pageResponse>>();
    authFetch.mockImplementation((url: string) => (
      url === '/api/notes?limit=30' ? pendingList.promise : Promise.resolve({ ok: true })
    ));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(user), { wrapper });

    await act(async () => { await result.current.deleteNote('note-1'); });
    await act(async () => { pendingList.resolve(pageResponse([staleNote])); });

    expect(cachedNotes(queryClient)).toEqual([]);
  });

  it('does not let a late GET erase a recommendation cache committed for the captured revision', async () => {
    const pendingList = deferred<ReturnType<typeof pageResponse>>();
    authFetch.mockImplementation((url: string) => (
      url === '/api/notes?limit=30' ? pendingList.promise : Promise.resolve(recommendationResponse())
    ));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(user), { wrapper });

    await act(async () => { await result.current.refreshRecommendCache('note-1'); });
    await act(async () => { pendingList.resolve(pageResponse([staleNote])); });

    expect(cachedNotes(queryClient)[0].recommendCache).toEqual(expect.objectContaining({ sourceRevision: 4 }));
  });

  it('keeps a newer complete cached snapshot when a delayed write returns an older revision', async () => {
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote));
    const newer: Note = { ...canonicalNote, title: '更晚的标题', revision: 6, enrichment: { sourceRevision: 6, status: 'ready' } };
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([newer]));
    const { result } = renderHook(() => useNotes(null), { wrapper });

    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } })).resolves.toEqual(newer);
    expect(cachedNotes(queryClient)).toEqual([newer]);
  });

  it('discards a stale newly requested next page after deletion instead of appending it', async () => {
    const next = deferred<ReturnType<typeof pageResponse>>();
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/notes?limit=30') return Promise.resolve(pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' }));
      if (url.includes('cursor=cursor-2')) return next.promise;
      return Promise.resolve({ ok: true });
    });
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/notes?limit=30&cursor=cursor-2', expect.anything()));
    await act(async () => { await result.current.deleteNote('note-1'); });
    await act(async () => { next.resolve(pageResponse([{ ...staleNote, _id: 'resurrected' }])); });
    expect(cachedNotes(queryClient)).toEqual([]);
  });
});

// These are the pre-pagination write regressions, migrated from the former
// Note[] cache suite.  Keep them independent: a page transport rewrite must
// not turn one broad mutation test into the only guard for several contracts.
describe('useNotes historical write regressions over infinite pages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an HTTP 200 write body that is not a successful canonical envelope', async () => {
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: false, data: { note: canonicalNote } }) });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } }))
      .rejects.toThrow('笔记写入响应无效');
    expect(cachedNotes(queryClient)).toEqual([staleNote]);
  });

  it('does not mutate a page when a 409 current snapshot is malformed', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({
      code: 'NOTE_WRITE_CONFLICT', current: { note: { _id: 'note-1', revision: 5 } },
    }) });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } }))
      .rejects.toThrow('笔记写入响应无效');
    expect(cachedNotes(queryClient)).toEqual([staleNote]);
  });

  it('rejects canonical enrichment revisions that do not exactly match the Note revision', async () => {
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote, { sourceRevision: 4, status: 'pending' }));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } }))
      .rejects.toThrow('笔记写入响应无效');
    expect(cachedNotes(queryClient)).toEqual([staleNote]);
  });

  it('rejects a structurally malformed successful canonical Note without changing the cached page', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { note: { _id: 'note-1', revision: 5 } } }) });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } }))
      .rejects.toThrow('笔记写入响应无效');
    expect(cachedNotes(queryClient)).toEqual([staleNote]);
  });

  it('rejects a 409 current snapshot with a fractional enrichment revision', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({
      code: 'NOTE_WRITE_CONFLICT', current: { note: canonicalNote, enrichment: { sourceRevision: 5.5, status: 'pending' } },
    }) });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' } }))
      .rejects.toThrow('笔记写入响应无效');
    expect(cachedNotes(queryClient)).toEqual([staleNote]);
  });

  it('keeps a newer cached Note when a delayed 409 carries an older current snapshot', async () => {
    const newer: Note = { ...canonicalNote, revision: 6, enrichment: { sourceRevision: 6, status: 'ready' } };
    authFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({
      code: 'NOTE_WRITE_CONFLICT', current: { note: canonicalNote, enrichment: canonicalNote.enrichment },
    }) });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([newer]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟标题' } }))
      .rejects.toMatchObject({ current: newer });
    expect(cachedNotes(queryClient)).toEqual([newer]);
  });

  it('keeps the newer concurrent canonical write when an older write resolves later', async () => {
    const first = deferred<ReturnType<typeof canonicalResponse>>();
    const second = deferred<ReturnType<typeof canonicalResponse>>();
    const newer: Note = { ...canonicalNote, revision: 6, enrichment: { sourceRevision: 6, status: 'ready' } };
    authFetch.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    let writeA!: Promise<Note>; let writeB!: Promise<Note>;
    act(() => {
      writeA = result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: 'A' } });
      writeB = result.current.updateNote({ noteId: 'note-1', expectedRevision: 5, changes: { title: 'B' } });
    });
    await act(async () => { second.resolve(canonicalResponse(newer)); await writeB; });
    await act(async () => { first.resolve(canonicalResponse(canonicalNote)); await writeA; });
    expect(cachedNotes(queryClient)).toEqual([newer]);
    await expect(writeA).resolves.toEqual(newer);
  });

  it('keeps the cached complete snapshot on equal-revision enrichment ties for success and 409', async () => {
    const cachedReady: Note = { ...canonicalNote, enrichment: { sourceRevision: 5, status: 'ready' }, recommendCache: { sourceRevision: 5, byCandidateId: {} } };
    const delayedReady: Note = { ...cachedReady, recommendCache: null };
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([cachedReady]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    authFetch.mockResolvedValueOnce(canonicalResponse(delayedReady));
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: 'tie' } })).resolves.toEqual(cachedReady);
    authFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({
      code: 'NOTE_WRITE_CONFLICT', current: { note: delayedReady, enrichment: delayedReady.enrichment },
    }) });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: 'tie' } }))
      .rejects.toMatchObject({ current: cachedReady });
    expect(cachedNotes(queryClient)).toEqual([cachedReady]);
  });

  it('accepts a higher equal-revision enrichment progress and fills a legacy snapshot without enrichment', async () => {
    const pending: Note = { ...canonicalNote, enrichment: { sourceRevision: 5, status: 'pending' }, recommendCache: null };
    const ready: Note = { ...pending, enrichment: { sourceRevision: 5, status: 'ready' }, recommendCache: { sourceRevision: 5, byCandidateId: {} } };
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([pending]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    authFetch.mockResolvedValueOnce(canonicalResponse(ready));
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: 'ready' } })).resolves.toEqual(ready);
    const legacy: Note = { ...canonicalNote, enrichment: undefined, recommendCache: { sourceRevision: 5, byCandidateId: {} } };
    const filled: Note = { ...canonicalNote, enrichment: { sourceRevision: 5, status: 'pending' }, recommendCache: null };
    act(() => queryClient.setQueryData<NotePages>(['notes'], pages([legacy])));
    authFetch.mockResolvedValueOnce(canonicalResponse(filled));
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: 'legacy' } })).resolves.toEqual(filled);
    expect(cachedNotes(queryClient)).toEqual([filled]);
  });

  it('does not let a same-revision pending canonical write replace an observed ready snapshot', async () => {
    const ready: Note = { ...canonicalNote, enrichment: { sourceRevision: 5, status: 'ready' }, recommendCache: { sourceRevision: 5, byCandidateId: {} } };
    const pending: Note = { ...canonicalNote, enrichment: { sourceRevision: 5, status: 'pending' }, recommendCache: null };
    authFetch.mockResolvedValue(canonicalResponse(pending));
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([ready]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '延迟' } })).resolves.toEqual(ready);
    expect(cachedNotes(queryClient)).toEqual([ready]);
  });

  it('keeps a hydrated newer canonical create when the delayed POST response is older', async () => {
    const post = deferred<ReturnType<typeof canonicalResponse>>();
    const delayed: Note = { ...canonicalNote, _id: 'created-note', revision: 1, enrichment: { sourceRevision: 1, status: 'pending' } };
    const hydrated: Note = { ...canonicalNote, _id: 'created-note', revision: 2, enrichment: { sourceRevision: 2, status: 'ready' }, recommendCache: { sourceRevision: 2, byCandidateId: {} } };
    authFetch.mockImplementation(() => post.promise);
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(null), { wrapper });
    let create!: Promise<Note>;
    act(() => { create = result.current.createNote({ body: { kind: 'plain-text', text: '内容' }, optimistic: { contentText: '内容' } }); });
    act(() => queryClient.setQueryData<NotePages>(['notes'], pages([hydrated])));
    await act(async () => { post.resolve(canonicalResponse(delayed)); await create; });
    expect(cachedNotes(queryClient)).toEqual([hydrated]);
    await expect(create).resolves.toEqual(hydrated);
  });

  it('keeps a hydrated complete create snapshot on an equal-revision delayed POST tie', async () => {
    const post = deferred<ReturnType<typeof canonicalResponse>>();
    const delayed: Note = { ...canonicalNote, _id: 'created-note', revision: 1, enrichment: { sourceRevision: 1, status: 'ready' }, recommendCache: null };
    const hydrated: Note = { ...delayed, recommendCache: { sourceRevision: 1, byCandidateId: {} } };
    authFetch.mockImplementation(() => post.promise);
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(null), { wrapper });
    let create!: Promise<Note>;
    act(() => { create = result.current.createNote({ body: { kind: 'plain-text', text: '内容' }, optimistic: { contentText: '内容' } }); });
    act(() => queryClient.setQueryData<NotePages>(['notes'], pages([hydrated])));
    await act(async () => { post.resolve(canonicalResponse(delayed)); await create; });
    await expect(create).resolves.toEqual(hydrated);
    expect(cachedNotes(queryClient)).toEqual([hydrated]);
  });

  it('hydrates the complete first-page list and merges its pending-to-ready transition', async () => {
    const ready: Note = { ...staleNote, enrichment: { sourceRevision: 4, status: 'ready' } };
    authFetch.mockResolvedValueOnce(pageResponse([canonicalNote])).mockResolvedValueOnce(pageResponse([ready]));
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(cachedNotes(queryClient)).toEqual([canonicalNote]));
    act(() => queryClient.setQueryData<NotePages>(['notes'], pages([staleNote])));
    await act(async () => { await result.current.refetchNotes(); });
    expect(cachedNotes(queryClient)[0].enrichment?.status).toBe('ready');
  });

  it('updates only the recommendation cache for the captured revision and rejects malformed responses', async () => {
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    authFetch.mockResolvedValueOnce(recommendationResponse());
    await result.current.refreshRecommendCache('note-1');
    expect(cachedNotes(queryClient)[0].recommendCache).toEqual(expect.objectContaining({ sourceRevision: 4 }));
    act(() => queryClient.setQueryData<NotePages>(['notes'], pages([staleNote])));
    authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { recommendations: 'not-an-array' } }) });
    await expect(result.current.refreshRecommendCache('note-1')).rejects.toThrow('推荐响应无效');
    expect(cachedNotes(queryClient)).toEqual([staleNote]);
  });

  it('discards a delayed recommendation response after the Note revision advances', async () => {
    const request = deferred<ReturnType<typeof recommendationResponse>>();
    const advanced: Note = { ...canonicalNote, enrichment: { sourceRevision: 5, status: 'ready' } };
    authFetch.mockImplementation(() => request.promise);
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(null), { wrapper });
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refreshRecommendCache('note-1'); });
    act(() => queryClient.setQueryData<NotePages>(['notes'], pages([advanced])));
    await act(async () => { request.resolve(recommendationResponse()); await refresh; });
    expect(cachedNotes(queryClient)).toEqual([advanced]);
  });

  it('does not let a late first-page GET overwrite a 409 current snapshot', async () => {
    const list = deferred<ReturnType<typeof pageResponse>>();
    authFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/notes?limit=30') return list.promise;
      if (options?.method === 'PATCH') return Promise.resolve({ ok: false, status: 409, json: async () => ({
        code: 'NOTE_WRITE_CONFLICT', current: { note: canonicalNote, enrichment: canonicalNote.enrichment },
      }) });
      throw new Error(`unexpected request: ${url}`);
    });
    const { queryClient, wrapper } = makeHarness();
    queryClient.setQueryData<NotePages>(['notes'], pages([staleNote]));
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: '冲突' } })).rejects.toBeInstanceOf(NoteWriteConflict);
    await act(async () => { list.resolve(pageResponse([staleNote])); });
    expect(cachedNotes(queryClient)).toEqual([canonicalNote]);
  });
});

describe('useNotes stale next-page write protection', () => {
  beforeEach(() => vi.clearAllMocks());

  async function beginDeferredNextPage() {
    const next = deferred<ReturnType<typeof pageResponse>>();
    const { queryClient, wrapper } = makeHarness();
    return { next, queryClient, wrapper };
  }

  it('does not append a stale next page after a successful create', async () => {
    const { next, queryClient, wrapper } = await beginDeferredNextPage();
    const created: Note = { ...canonicalNote, _id: 'created', revision: 1, enrichment: { sourceRevision: 1, status: 'pending' } };
    authFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/notes?limit=30') return Promise.resolve(pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' }));
      if (url.includes('cursor=cursor-2')) return next.promise;
      if (options?.method === 'POST') return Promise.resolve(canonicalResponse(created));
      throw new Error(`unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    let loadMore!: Promise<void>;
    act(() => { loadMore = result.current.loadMore(); });
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/notes?limit=30&cursor=cursor-2', expect.anything()));
    await act(async () => { await result.current.createNote({ body: { kind: 'plain-text', text: '新建' }, optimistic: { contentText: '新建' } }); });
    await act(async () => { next.resolve(pageResponse([{ ...staleNote, _id: 'stale-next' }])); await expect(loadMore).resolves.toBeUndefined(); });
    expect(cachedNotes(queryClient).map((note) => note._id)).toEqual(['created', 'note-1']);
    expect(result.current.isFetchNextPageError).toBe(false);
  });

  it('does not append a stale next page after a successful PATCH', async () => {
    const { next, queryClient, wrapper } = await beginDeferredNextPage();
    authFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/notes?limit=30') return Promise.resolve(pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' }));
      if (url.includes('cursor=cursor-2')) return next.promise;
      if (options?.method === 'PATCH') return Promise.resolve(canonicalResponse(canonicalNote));
      throw new Error(`unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/notes?limit=30&cursor=cursor-2', expect.anything()));
    await act(async () => { await result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: 'PATCH' } }); });
    await act(async () => { next.resolve(pageResponse([{ ...staleNote, _id: 'stale-next' }])); });
    expect(cachedNotes(queryClient)).toEqual([canonicalNote]);
  });

  it('does not append a stale next page after a PATCH 409 commits its current snapshot', async () => {
    const { next, queryClient, wrapper } = await beginDeferredNextPage();
    authFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/notes?limit=30') return Promise.resolve(pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' }));
      if (url.includes('cursor=cursor-2')) return next.promise;
      if (options?.method === 'PATCH') return Promise.resolve({ ok: false, status: 409, json: async () => ({
        code: 'NOTE_WRITE_CONFLICT', current: { note: canonicalNote, enrichment: canonicalNote.enrichment },
      }) });
      throw new Error(`unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/notes?limit=30&cursor=cursor-2', expect.anything()));
    await expect(result.current.updateNote({ noteId: 'note-1', expectedRevision: 4, changes: { title: 'PATCH' } })).rejects.toBeInstanceOf(NoteWriteConflict);
    await act(async () => { next.resolve(pageResponse([{ ...staleNote, _id: 'stale-next' }])); });
    expect(cachedNotes(queryClient)).toEqual([canonicalNote]);
  });

  it('does not append a stale next page after a recommendation refresh commits its captured revision', async () => {
    const { next, queryClient, wrapper } = await beginDeferredNextPage();
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/notes?limit=30') return Promise.resolve(pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' }));
      if (url.includes('cursor=cursor-2')) return next.promise;
      if (url === '/api/recommend/semantic-notes') return Promise.resolve(recommendationResponse());
      throw new Error(`unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useNotes(user), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/notes?limit=30&cursor=cursor-2', expect.anything()));
    await act(async () => { await result.current.refreshRecommendCache('note-1'); });
    await act(async () => { next.resolve(pageResponse([{ ...staleNote, _id: 'stale-next' }])); });
    expect(cachedNotes(queryClient)).toEqual([expect.objectContaining({ _id: 'note-1', recommendCache: expect.objectContaining({ sourceRevision: 4 }) })]);
  });

  it('does not append a stale next page after polling refreshes the pending Note', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const next = deferred<ReturnType<typeof pageResponse>>();
    const ready: Note = { ...staleNote, enrichment: { sourceRevision: 4, status: 'ready' } };
    let firstPageCalls = 0;
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/notes?limit=30') {
        firstPageCalls += 1;
        return Promise.resolve(firstPageCalls === 1
          ? pageResponse([staleNote], { hasNextPage: true, nextCursor: 'cursor-2' })
          : pageResponse([ready], { hasNextPage: true, nextCursor: 'cursor-2' }));
      }
      if (url.includes('cursor=cursor-2')) return next.promise;
      throw new Error(`unexpected request: ${url}`);
    });
    const { queryClient, wrapper } = makeHarness();
    const { result, unmount } = renderHook(() => useNotes(user), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(firstPageCalls).toBe(1);
    expect(result.current.hasNextPage).toBe(true);
    act(() => { void result.current.loadMore(); });
    expect(authFetch).toHaveBeenCalledWith('/api/notes?limit=30&cursor=cursor-2', expect.anything());
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(firstPageCalls).toBe(2);
    await act(async () => { next.resolve(pageResponse([{ ...staleNote, _id: 'stale-next' }])); });
    expect(cachedNotes(queryClient)).toEqual([ready]);
    unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

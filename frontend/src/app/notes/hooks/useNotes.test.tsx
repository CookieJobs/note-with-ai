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

function canonicalResponse(note: Note) {
  return { ok: true, json: async () => ({ success: true, data: { note, enrichment: note.enrichment } }) };
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
});

import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecommendCacheState } from '../utils/recommendCache';
import { useNoteEditor } from './useNoteEditor';
import type { Note } from './useNotes';
import { useNotes } from './useNotes';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('../../../utils/auth', () => ({ authFetch }));

const cacheAtRevisionFive = {
  sourceRevision: 5,
  sourceUpdatedAt: '2026-08-18T00:01:00.000Z',
  byCandidateId: {},
};

const initialNote: Note = {
  _id: 'note-1',
  content: '正文',
  contentText: '正文',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] },
  title: '正文',
  summary: '',
  concepts: [],
  keywords: ['旧关键词'],
  recommendCache: {
    sourceRevision: 4,
    sourceUpdatedAt: '2026-08-18T00:00:00.000Z',
    byCandidateId: {},
  },
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

function makeHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function useEditorWithNotesStore() {
  const notesStore = useNotes(null);
  const note = notesStore.notes[0] ?? initialNote;
  const editor = useNoteEditor({ note, updateNote: notesStore.updateNote });
  return { notesStore, editor };
}

function canonicalResponse(note: Note) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { note, enrichment: note.enrichment },
    }),
  };
}

describe('canonical recommendCache propagation after a Note PATCH', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the canonical cache after a JSON-only body update without positional propagation', async () => {
    const canonicalNote: Note = {
      ...initialNote,
      revision: 5,
      updatedAt: '2026-08-18T00:01:00.000Z',
      contentJson: { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: '正文' }] }] },
      recommendCache: cacheAtRevisionFive,
      enrichment: { sourceRevision: 5, status: 'ready' },
    };
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote));
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(useEditorWithNotesStore, { wrapper });

    act(() => queryClient.setQueryData<Note[]>(['notes'], [initialNote]));
    act(() => result.current.editor.enterContentEdit());
    act(() => result.current.editor.onEditorChange({ json: canonicalNote.contentJson!, text: '正文' }));
    await act(async () => {
      await result.current.editor.handleSaveContent();
    });

    const stored = queryClient.getQueryData<Note[]>(['notes'])?.[0];
    expect(stored).toEqual(canonicalNote);
    expect(getRecommendCacheState(stored).needsRefresh).toBe(false);
  });

  it('keeps the canonical cache after a keyword-only update without positional propagation', async () => {
    const canonicalNote: Note = {
      ...initialNote,
      keywords: ['新关键词'],
      revision: 5,
      updatedAt: '2026-08-18T00:01:00.000Z',
      recommendCache: cacheAtRevisionFive,
      enrichment: { sourceRevision: 5, status: 'ready' },
    };
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote));
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(useEditorWithNotesStore, { wrapper });

    act(() => queryClient.setQueryData<Note[]>(['notes'], [initialNote]));
    act(() => result.current.editor.beginKeywordEdit(0, '旧关键词'));
    act(() => result.current.editor.setTagEditValue('新关键词'));
    await act(async () => {
      await result.current.editor.commitKeywordAt(0);
    });

    const stored = queryClient.getQueryData<Note[]>(['notes'])?.[0];
    expect(stored).toEqual(canonicalNote);
    expect(getRecommendCacheState(stored).needsRefresh).toBe(false);
  });

  it('clears a stale recommendation cache when the canonical update returns null', async () => {
    const canonicalNote: Note = {
      ...initialNote,
      title: '新标题',
      revision: 5,
      recommendCache: null,
      enrichment: { sourceRevision: 5, status: 'pending' },
    };
    authFetch.mockResolvedValue(canonicalResponse(canonicalNote));
    const { queryClient, wrapper } = makeHarness();
    const { result } = renderHook(useEditorWithNotesStore, { wrapper });

    act(() => queryClient.setQueryData<Note[]>(['notes'], [initialNote]));
    act(() => {
      result.current.editor.beginTitleEdit();
      result.current.editor.dispatch({ type: 'CHANGE_TITLE', value: '新标题' });
    });
    await act(async () => {
      await result.current.editor.handleSaveTitle();
    });

    expect(queryClient.getQueryData<Note[]>(['notes'])?.[0].recommendCache).toBeNull();
  });
});

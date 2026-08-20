import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteWriteConflict, type Note } from './useNotes';
import { useNoteEditor } from './useNoteEditor';

const note: Note = {
  _id: 'note-1',
  content: '旧正文',
  contentText: '旧正文',
  contentJson: {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧正文' }] }],
  },
  title: '旧标题', summary: '', concepts: [], keywords: ['原关键词'], recommendCache: null, revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
};

const updatedNote: Note = {
  ...note,
  content: '新正文', contentText: '新正文', revision: 5,
  updatedAt: '2026-08-18T00:01:00.000Z',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新正文' }] }] },
  enrichment: { sourceRevision: 5, status: 'pending' },
};

describe('useNoteEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a body through one update intent with its edit baseline revision', async () => {
    const updateNote = vi.fn().mockResolvedValue(updatedNote);
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));

    act(() => result.current.enterContentEdit());
    act(() => result.current.onEditorChange({ json: updatedNote.contentJson!, text: '新正文' }));
    await act(async () => {
      await result.current.handleSaveContent();
    });

    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith({
      noteId: 'note-1',
      expectedRevision: 4,
      changes: { body: { kind: 'rich-text', document: updatedNote.contentJson } },
    });
  });

  it('saves title and keywords through the same update intent', async () => {
    const updateNote = vi.fn()
      .mockResolvedValueOnce({ ...updatedNote, title: '新标题' })
      .mockResolvedValueOnce({ ...updatedNote, keywords: ['新关键词'] });
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));

    act(() => {
      result.current.beginTitleEdit();
      result.current.dispatch({ type: 'CHANGE_TITLE', value: '新标题' });
    });
    await act(async () => {
      await result.current.handleSaveTitle();
    });
    act(() => result.current.beginKeywordEdit(0, '原关键词'));
    act(() => result.current.setTagEditValue('新关键词'));
    await act(async () => {
      await result.current.commitKeywordAt(0);
    });

    expect(updateNote).toHaveBeenNthCalledWith(1, {
      noteId: 'note-1', expectedRevision: 4, changes: { title: '新标题' },
    });
    expect(updateNote).toHaveBeenNthCalledWith(2, {
      noteId: 'note-1', expectedRevision: 4, changes: { keywords: ['新关键词'] },
    });
  });

  it('keeps a body draft after conflict and uses the returned revision only on an explicit retry', async () => {
    const serverRevisionFive: Note = {
      ...updatedNote,
      content: '服务端正文',
      contentText: '服务端正文',
      revision: 5,
      enrichment: { sourceRevision: 5, status: 'pending' },
    };
    const updateNote = vi.fn()
      .mockRejectedValueOnce(new NoteWriteConflict(serverRevisionFive))
      .mockResolvedValueOnce(updatedNote);
    const { result, rerender } = renderHook(
      ({ currentNote }) => useNoteEditor({ note: currentNote, updateNote }),
      { initialProps: { currentNote: note } },
    );

    act(() => result.current.enterContentEdit());
    act(() => result.current.onEditorChange({ json: updatedNote.contentJson!, text: '我的本地草稿' }));
    rerender({ currentNote: serverRevisionFive });
    await act(async () => {
      await result.current.handleSaveContent();
    });

    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(result.current.state.content.isEditing).toBe(true);
    expect(result.current.contentTextDraft).toBe('我的本地草稿');
    expect(result.current.state.content.conflictCurrentText).toBe('服务端正文');

    await act(async () => {
      await result.current.handleSaveContent();
    });
    expect(updateNote).toHaveBeenCalledTimes(2);
    expect(updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 5 }));
  });

  it('keeps a keyword edit retryable after a typed conflict', async () => {
    const updateNote = vi.fn().mockRejectedValue(new NoteWriteConflict(updatedNote));
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));

    act(() => result.current.beginKeywordEdit(0, '原关键词'));
    act(() => result.current.setTagEditValue('本地关键词'));
    await act(async () => {
      await result.current.commitKeywordAt(0);
    });

    expect(result.current.activeKeywordIndex).toBe(0);
    expect(result.current.tagEditValue).toBe('本地关键词');
    expect(result.current.keywordError).toBe('关键词已被其他写入更新。本地编辑已保留，请重试。');
  });

  it('keeps a typed title conflict visible and only uses its current revision on an explicit retry', async () => {
    const serverRevisionFive: Note = {
      ...updatedNote,
      title: '服务端标题',
      revision: 5,
      enrichment: { sourceRevision: 5, status: 'pending' },
    };
    const updateNote = vi.fn()
      .mockRejectedValueOnce(new NoteWriteConflict(serverRevisionFive))
      .mockResolvedValueOnce({ ...serverRevisionFive, title: '本地标题', revision: 6, enrichment: { sourceRevision: 6, status: 'pending' } });
    const { result, rerender } = renderHook(
      ({ currentNote }) => useNoteEditor({ note: currentNote, updateNote }),
      { initialProps: { currentNote: note } },
    );

    act(() => {
      result.current.beginTitleEdit();
      result.current.dispatch({ type: 'CHANGE_TITLE', value: '本地标题' });
    });
    rerender({ currentNote: serverRevisionFive });
    await act(async () => {
      await result.current.handleSaveTitle();
    });

    expect(updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(result.current.state.title.isEditing).toBe(true);
    expect(result.current.state.title.value).toBe('本地标题');
    expect(result.current.state.title.error).toContain('笔记已被其他写入更新');
    expect(result.current.state.title.conflictCurrentTitle).toBe('服务端标题');

    await act(async () => {
      await result.current.handleSaveTitle();
    });
    expect(updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 5 }));
  });

  it.each([
    {
      operation: 'edit',
      serverKeywords: ['服务端前', '原关键词'],
      start: (current: ReturnType<typeof useNoteEditor>) => {
        current.beginKeywordEdit(0, '原关键词');
        current.setTagEditValue('本地关键词');
      },
      initialCommit: (current: ReturnType<typeof useNoteEditor>) => current.commitKeywordAt(0),
      retry: (current: ReturnType<typeof useNoteEditor>) => current.commitKeywordAt(1),
      expected: ['服务端前', '本地关键词'],
    },
    {
      operation: 'add',
      serverKeywords: ['服务端前', '原关键词'],
      start: (current: ReturnType<typeof useNoteEditor>) => {
        current.beginKeywordEdit(1, '');
        current.setTagEditValue('本地关键词');
      },
      initialCommit: (current: ReturnType<typeof useNoteEditor>) => current.commitKeywordAt(1),
      retry: (current: ReturnType<typeof useNoteEditor>) => current.commitKeywordAt(2),
      expected: ['服务端前', '原关键词', '本地关键词'],
    },
    {
      operation: 'delete',
      serverKeywords: ['服务端前', '原关键词'],
      start: (current: ReturnType<typeof useNoteEditor>) => current.deleteKeywordAt(0),
      initialCommit: () => undefined,
      retry: (current: ReturnType<typeof useNoteEditor>) => current.deleteKeywordAt(1),
      expected: ['服务端前'],
    },
  ])('retries a conflicted keyword $operation against changed server topology without changing the original intent', async ({ serverKeywords, start, initialCommit, retry, expected }) => {
    const serverRevisionFive: Note = {
      ...updatedNote,
      keywords: serverKeywords,
      revision: 5,
      enrichment: { sourceRevision: 5, status: 'pending' },
    };
    const updateNote = vi.fn()
      .mockRejectedValueOnce(new NoteWriteConflict(serverRevisionFive))
      .mockResolvedValueOnce({ ...serverRevisionFive, keywords: expected, revision: 6, enrichment: { sourceRevision: 6, status: 'pending' } });
    const { result, rerender } = renderHook(
      ({ currentNote }) => useNoteEditor({ note: currentNote, updateNote }),
      { initialProps: { currentNote: note } },
    );

    await act(async () => {
      await start(result.current);
    });
    await act(async () => {
      await initialCommit(result.current);
    });
    rerender({ currentNote: serverRevisionFive });
    await act(async () => {
      await retry(result.current);
    });

    expect(updateNote).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedRevision: 5,
      changes: { keywords: expected },
    }));
  });
});

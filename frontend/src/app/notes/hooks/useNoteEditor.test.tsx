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
  title: '旧标题', revision: 4,
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

});

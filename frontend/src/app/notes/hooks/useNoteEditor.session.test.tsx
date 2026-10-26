import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNoteEditor } from './useNoteEditor';
import type { Note } from './useNotes';

const body = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const note: Note = { _id: 'n', title: '旧标题', content: '旧正文', contentText: '旧正文', contentJson: body('旧正文'),
  revision: 4, createdAt: '', updatedAt: '' };

describe('unified note edit session', () => {
  it('opens the whole editor from its title and closes both fields when another editor takes over', () => {
    const { result, rerender } = renderHook(({ active }) => useNoteEditor({ note, updateNote: vi.fn(), isContentEditingActive: active }),
      { initialProps: { active: false } });
    act(() => result.current.beginTitleEdit());
    expect(result.current.state.title.isEditing).toBe(true);
    expect(result.current.state.content.isEditing).toBe(true);
    rerender({ active: true });
    act(() => result.current.changeTitle('待保存标题'));
    rerender({ active: false });
    expect(result.current.state.title.isEditing).toBe(false);
    expect(result.current.state.content.isEditing).toBe(false);
    expect(result.current.state.title.value).toBe('待保存标题');
  });

  it('submits title and body in one revisioned update', async () => {
    const updateNote = vi.fn().mockResolvedValue({ ...note, title: '新标题', contentText: '新正文', contentJson: body('新正文'), revision: 5 });
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));
    act(() => { result.current.beginTitleEdit(); result.current.changeTitle('新标题'); result.current.enterContentEdit(); result.current.onEditorChange({ json: body('新正文'), text: '新正文' }); });
    await act(async () => { await result.current.handleSaveTitle(); });
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'n', expectedRevision: 4,
      changes: { title: '新标题', body: { kind: 'rich-text', document: body('新正文') } } });
  });

  it('preserves edits made during a save and advances the accepted baseline', async () => {
    let finish!: (note: Note) => void;
    const updateNote = vi.fn(() => new Promise<Note>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));
    act(() => { result.current.beginTitleEdit(); result.current.changeTitle('提交标题'); });
    let save!: Promise<boolean>;
    act(() => { save = result.current.handleSaveTitle(); });
    act(() => result.current.changeTitle('后来标题'));
    await act(async () => { finish({ ...note, title: '提交标题', revision: 5 }); await save; });
    expect(result.current.state.title.value).toBe('后来标题');
    expect(result.current.state.title.isEditing).toBe(true);
    await act(async () => { const next = result.current.handleSaveTitle(); finish({ ...note, title: '后来标题', revision: 6 }); await next; });
    expect(updateNote).toHaveBeenLastCalledWith({ noteId: 'n', expectedRevision: 5, changes: { title: '后来标题' } });
  });

  it('clears a title without submitting an unchanged body', async () => {
    const updateNote = vi.fn().mockResolvedValue({ ...note, title: '', revision: 5 });
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));
    act(() => { result.current.beginTitleEdit(); result.current.changeTitle(''); });
    await act(async () => { await result.current.handleSaveTitle(); });
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'n', expectedRevision: 4, changes: { title: '' } });
  });

  it('saves only the body of a legacy note whose unchanged title exceeds the new limit', async () => {
    const legacy = { ...note, title: '旧'.repeat(101) };
    const updateNote = vi.fn().mockResolvedValue({ ...legacy, contentText: '新正文', contentJson: body('新正文'), revision: 5 });
    const { result } = renderHook(() => useNoteEditor({ note: legacy, updateNote }));
    act(() => { result.current.enterContentEdit(); result.current.onEditorChange({ json: body('新正文'), text: '新正文' }); });
    await act(async () => { await result.current.handleSaveContent(); });
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'n', expectedRevision: 4,
      changes: { body: { kind: 'rich-text', document: body('新正文') } } });
  });

  it('preserves whitespace around an over-limit legacy title during a body-only edit', async () => {
    const legacyTitle = `  ${'旧'.repeat(101)}  `;
    const legacy = { ...note, title: legacyTitle };
    const updateNote = vi.fn().mockResolvedValue({ ...legacy, contentText: '新正文', contentJson: body('新正文'), revision: 5 });
    const external = vi.fn();
    const { result } = renderHook(() => useNoteEditor({ note: legacy, updateNote, onDraftChange: external }));
    act(() => { result.current.enterContentEdit(); result.current.onEditorChange({ json: body('新正文'), text: '新正文' }); });
    expect(external.mock.lastCall?.[1]?.baseline.title).toBe(legacyTitle);
    await act(async () => { await result.current.handleSaveContent(); });
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'n', expectedRevision: 4,
      changes: { body: { kind: 'rich-text', document: body('新正文') } } });
  });

  it('ignores a canceled save error and preserves a new session', async () => {
    let reject!: (error: Error) => void;
    const updateNote = vi.fn(() => new Promise<Note>((_, fail) => { reject = fail; }));
    const external = vi.fn();
    const { result } = renderHook(() => useNoteEditor({ note, updateNote, onDraftChange: external }));
    act(() => result.current.changeTitle('取消的标题'));
    let save!: Promise<boolean>;
    act(() => { save = result.current.handleSaveTitle(); });
    act(() => { result.current.cancel(); result.current.beginTitleEdit(); result.current.changeTitle('新会话标题'); });
    await act(async () => { reject(new Error('旧请求失败')); await save; });
    expect(result.current.state.title.value).toBe('新会话标题');
    expect(result.current.state.title.error).toBe('');
    expect(external.mock.lastCall?.[1]?.title).toBe('新会话标题');
  });

  it('uses a canceled request’s accepted revision as the new session baseline', async () => {
    let finish!: (note: Note) => void;
    const updateNote = vi.fn(() => new Promise<Note>((resolve) => { finish = resolve; }));
    const external = vi.fn();
    const { result } = renderHook(() => useNoteEditor({ note, updateNote, onDraftChange: external }));
    act(() => result.current.changeTitle('取消的标题'));
    let save!: Promise<boolean>;
    act(() => { save = result.current.handleSaveTitle(); });
    act(() => { result.current.cancel(); result.current.beginTitleEdit(); result.current.changeTitle('新会话标题'); });
    await act(async () => { finish({ ...note, title: '取消的标题', revision: 5 }); await save; });
    expect(result.current.state.title.value).toBe('新会话标题');
    expect(external.mock.lastCall?.[1]?.baseline.revision).toBe(5);
    expect(external.mock.lastCall?.[1]?.baseline.title).toBe('取消的标题');
    await act(async () => { const next = result.current.handleSaveTitle(); finish({ ...note, title: '新会话标题', revision: 6 }); await next; });
    expect(updateNote).toHaveBeenLastCalledWith({ noteId: 'n', expectedRevision: 5, changes: { title: '新会话标题' } });
  });

  it('keeps the conflict retry revision in the external draft across remount', async () => {
    const server = { ...note, title: '远端', revision: 5 };
    const external = vi.fn();
    const updateNote = vi.fn().mockRejectedValueOnce(new (await import('./useNotes')).NoteWriteConflict(server))
      .mockResolvedValueOnce({ ...server, title: '本地', revision: 6 });
    const first = renderHook(() => useNoteEditor({ note, updateNote, onDraftChange: external }));
    act(() => { first.result.current.beginTitleEdit(); first.result.current.changeTitle('本地'); });
    await act(async () => { await first.result.current.handleSaveTitle(); });
    const savedDraft = external.mock.lastCall?.[1];
    expect(savedDraft.baseline.revision).toBe(5);
    first.unmount();
    const second = renderHook(() => useNoteEditor({ note: server, updateNote, draft: savedDraft }));
    await act(async () => { await second.result.current.handleSaveTitle(); });
    expect(updateNote).toHaveBeenLastCalledWith({ noteId: 'n', expectedRevision: 5, changes: { title: '本地' } });
  });

  it('publishes a remotely refreshed clean body while preserving the dirty title and conflict baseline', () => {
    const external = vi.fn();
    const updateNote = vi.fn();
    const first = renderHook(({ currentNote }) => useNoteEditor({ note: currentNote, updateNote, onDraftChange: external }),
      { initialProps: { currentNote: note } });
    act(() => first.result.current.changeTitle('本地标题'));

    const refreshed = { ...note, content: '远端正文', contentText: '远端正文', contentJson: body('远端正文'), revision: 5 };
    first.rerender({ currentNote: refreshed });

    const savedDraft = external.mock.lastCall?.[1];
    expect(savedDraft).toMatchObject({ title: '本地标题', text: '远端正文', dirty: true,
      baseline: { title: '旧标题', text: '远端正文', revision: 4 } });
    expect(savedDraft.json).toEqual(body('远端正文'));
    expect(first.result.current.contentJsonDraft).toEqual(body('远端正文'));
    expect(first.result.current.contentTextDraft).toBe('远端正文');

    first.unmount();
    const second = renderHook(() => useNoteEditor({ note: refreshed, updateNote, draft: savedDraft }));
    expect(second.result.current.state.title.value).toBe('本地标题');
    expect(second.result.current.contentJsonDraft).toEqual(body('远端正文'));
    expect(second.result.current.contentTextDraft).toBe('远端正文');
  });
});

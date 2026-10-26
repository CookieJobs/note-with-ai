import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, type WorkspaceContextValue, type WorkspaceEditor } from '../../../components/workspace/WorkspaceContext';
import type { Note } from '../hooks/useNotes';
import NoteWorkspaceEditor from './NoteWorkspaceEditor';

const note = { _id: 'n1', title: '原题', content: '正文', contentText: '正文', contentJson: null, revision: 1 } as Note;
let registered: WorkspaceEditor;
const unregister = vi.fn();
const context: WorkspaceContextValue = { navigate: vi.fn(), requestAction: vi.fn((action) => action()), setRecentNotes: vi.fn(), registerEditor: vi.fn((editor) => { registered = editor; return unregister; }) };

describe('NoteWorkspaceEditor', () => {
  it('returns to reading when saving an unchanged note, without an empty write', async () => {
    const updateNote = vi.fn(), onSaved = vi.fn();
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="edit" note={note} userId="u1" updateNote={updateNote} onSaved={onSaved} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(updateNote).not.toHaveBeenCalled();
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  beforeEach(() => {
    vi.clearAllMocks();
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), { getBoundingClientRect: () => new DOMRect(), getClientRects: () => [] as unknown as DOMRectList }));
  });

  it('saves explicitly using the real revision hook, including Cmd+Enter from the title', async () => {
    const updateNote = vi.fn().mockResolvedValue({ ...note, title: '新题', revision: 2 });
    const onSaved = vi.fn();
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="edit" note={note} userId="u1" updateNote={updateNote} onSaved={onSaved} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    const title = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(title, { target: { value: '新题' } });
    expect(updateNote).not.toHaveBeenCalled(); expect(registered.isDirty()).toBe(true);
    fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'n1', expectedRevision: 1, changes: { title: '新题' } });
    expect(registered.isDirty()).toBe(false);
  });

  it('keeps the editor and input after a failed save', async () => {
    const updateNote = vi.fn().mockRejectedValue(new Error('网络中断')); const onSaved = vi.fn();
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="edit" note={note} userId="u1" updateNote={updateNote} onSaved={onSaved} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    fireEvent.change(screen.getByRole('textbox', { name: '笔记标题' }), { target: { value: '未保存' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('未保存');
    expect(onSaved).not.toHaveBeenCalled(); expect(registered.isDirty()).toBe(true);
  });

  it('allows saving a title change on an image-only existing note', async () => {
    const imageNote = { ...note, title: '图片记录', content: '![图片](/test-note.png)', contentText: '', contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: '/test-note.png' } }] } } as Note;
    const updateNote = vi.fn().mockResolvedValue({ ...imageNote, title: '图片说明', revision: 2 });
    const onSaved = vi.fn();
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="edit" note={imageNote} userId="u1" updateNote={updateNote} onSaved={onSaved} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    fireEvent.change(screen.getByRole('textbox', { name: '笔记标题' }), { target: { value: '图片说明' } });
    expect(screen.getByRole('button', { name: /^保存$/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'n1', expectedRevision: 1, changes: { title: '图片说明' } });
  });

  it('does not acknowledge later input or exit while an earlier title is saving', async () => {
    let finish!: (value: Note) => void;
    const updateNote = vi.fn(() => new Promise<Note>((resolve) => { finish = resolve; })); const onSaved = vi.fn();
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="edit" note={note} userId="u1" updateNote={updateNote} onSaved={onSaved} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    fireEvent.change(screen.getByRole('textbox', { name: '笔记标题' }), { target: { value: '提交' } });
    let pending!: Promise<boolean>;
    act(() => { pending = registered.save(); });
    expect(registered.isSaving()).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: '笔记标题' }), { target: { value: '后续输入' } });
    let acknowledged: unknown;
    await act(async () => { finish({ ...note, title: '提交', revision: 2 }); acknowledged = await pending; });
    expect(acknowledged).toBe(false); expect(registered.isDirty()).toBe(true); expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('后续输入');
  });

  it('keeps one guard registration and the draft when its parent rerenders for settings', () => {
    const updateNote = vi.fn(); const onSaved = vi.fn(); const onCancel = vi.fn();
    const editor = <NoteWorkspaceEditor mode="edit" note={note} userId="u1" updateNote={updateNote} onSaved={onSaved} onCancel={onCancel} />;
    const view = render(<WorkspaceContext.Provider value={context}><span />{editor}</WorkspaceContext.Provider>);
    fireEvent.change(screen.getByRole('textbox', { name: '笔记标题' }), { target: { value: '草稿' } });
    view.rerender(<WorkspaceContext.Provider value={{ ...context }}><span>设置已打开</span>{editor}</WorkspaceContext.Provider>);
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('草稿');
    expect(unregister).not.toHaveBeenCalled(); expect(context.registerEditor).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(context.requestAction).toHaveBeenCalled(); expect(onCancel).toHaveBeenCalled();
  });

  it('runs actual Tiptap format commands, exposes selected state, and saves the formatted document', async () => {
    const updateNote = vi.fn().mockImplementation(async (command) => ({ ...note, contentJson: command.changes.body?.document, revision: 2 }));
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="edit" note={note} userId="u1" updateNote={updateNote} onSaved={vi.fn()} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    const heading = await screen.findByRole('button', { name: '二级标题' });
    expect(heading).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(heading);
    await waitFor(() => expect(heading).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('textbox', { name: '笔记正文' }).querySelector('h2')).toHaveTextContent('正文');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateNote).toHaveBeenCalled());
    expect(updateNote.mock.calls[0][0].changes.body.document.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  it('restores the real creation draft and leaves the guarded target to the workspace after saving', async () => {
    localStorage.setItem('quick-capture-draft:u1', JSON.stringify({ version: 2, title: '草稿标题', text: '恢复的草稿正文', json: null }));
    const createNote = vi.fn().mockResolvedValue({ ...note, _id: 'created' }); const onSaved = vi.fn();
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="compose" userId="u1" createNote={createNote} onSaved={onSaved} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('草稿标题');
    expect(screen.getByRole('textbox', { name: '笔记正文' })).toHaveTextContent('恢复的草稿正文');
    expect(registered.isDirty()).toBe(true);
    let saved: unknown;
    let dirtyAtAcknowledgement: unknown;
    await act(async () => { saved = await registered.save(); dirtyAtAcknowledgement = registered.isDirty(); });
    expect(saved).toBe(true); expect(registered.isDirty()).toBe(false);
    expect(dirtyAtAcknowledgement).toBe(false);
    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ title: '草稿标题', optimistic: expect.objectContaining({ contentText: '恢复的草稿正文' }) }));
    expect(localStorage.getItem('quick-capture-draft:u1')).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('acknowledges a completed network save before React publishes the cleared loading view', async () => {
    localStorage.setItem('quick-capture-draft:u1', JSON.stringify({ version: 2, title: '网络保存', text: '待保存的正文', json: null }));
    let finish!: (value: Note) => void;
    const createNote = vi.fn(() => new Promise<Note>((resolve) => { finish = resolve; }));
    render(<WorkspaceContext.Provider value={context}><NoteWorkspaceEditor mode="compose" userId="u1" createNote={createNote} onSaved={vi.fn()} onCancel={vi.fn()} /></WorkspaceContext.Provider>);
    let pending!: Promise<boolean>;
    act(() => { pending = registered.save(); });
    expect(registered.isSaving()).toBe(true);
    await act(async () => {
      finish({ ...note, _id: 'network-created' });
      expect(await pending).toBe(true);
      expect(registered.isDirty()).toBe(false);
      expect(registered.isSaving()).toBe(false);
    });
  });
});

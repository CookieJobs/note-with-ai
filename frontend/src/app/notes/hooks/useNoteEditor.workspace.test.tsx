import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNoteEditor } from './useNoteEditor';
import type { Note } from './useNotes';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const note = { _id: 'n1', title: '', content: '原文', contentText: '原文', contentJson: doc('原文'), revision: 1, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' } as Note;

describe('workspace editor save acknowledgement', () => {
  it('returns true only after an acknowledged write and exposes live dirty getters', async () => {
    const updateNote = vi.fn().mockResolvedValue({ ...note, contentText: '修改', contentJson: doc('修改'), revision: 2 });
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));
    const getDirty = () => result.current.isDirty();
    expect(getDirty()).toBe(false);
    act(() => result.current.onEditorChange({ text: '修改', json: doc('修改') }));
    expect(getDirty()).toBe(true);
    let saved: unknown;
    await act(async () => { saved = await result.current.handleSaveContent(); });
    expect(saved).toBe(true);
    expect(getDirty()).toBe(false);
  });

  it('keeps later input dirty and returns false even when the earlier request succeeds', async () => {
    let finish!: (value: Note) => void;
    const updateNote = vi.fn(() => new Promise<Note>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));
    act(() => result.current.onEditorChange({ text: '提交', json: doc('提交') }));
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.handleSaveContent(); });
    expect(result.current.isSaving()).toBe(true);
    act(() => result.current.onEditorChange({ text: '后来的修改', json: doc('后来的修改') }));
    let saved: unknown;
    await act(async () => { finish({ ...note, contentText: '提交', contentJson: doc('提交'), revision: 2 }); saved = await pending; });
    expect(saved).toBe(false);
    expect(result.current.contentTextDraft).toBe('后来的修改');
    expect(result.current.isDirty()).toBe(true);
    expect(result.current.isSaving()).toBe(false);
  });

  it('returns false on failed writes and preserves the same title/body transaction for retry', async () => {
    const updateNote = vi.fn().mockRejectedValue(new Error('离线'));
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));
    act(() => { result.current.changeTitle('标题'); result.current.onEditorChange({ text: '正文', json: doc('正文') }); });
    let saved: unknown;
    await act(async () => { saved = await result.current.handleSaveContent(); });
    expect(saved).toBe(false);
    expect(result.current.isDirty()).toBe(true);
    expect(result.current.state.content.error).toBe('离线');
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'n1', expectedRevision: 1, changes: { title: '标题', body: { kind: 'rich-text', document: doc('正文') } } });
  });

  it('adopts the canonical server document when no input changed after submission', async () => {
    const updateNote = vi.fn().mockResolvedValue({ ...note, contentText: '标准正文', contentJson: doc('标准正文'), revision: 2 });
    const { result } = renderHook(() => useNoteEditor({ note, updateNote }));
    act(() => result.current.onEditorChange({ text: '提交正文', json: doc('提交正文') }));
    let saved: unknown;
    await act(async () => { saved = await result.current.handleSaveContent(); });
    expect(saved).toBe(true);
    expect(result.current.contentTextDraft).toBe('标准正文');
    expect(result.current.isDirty()).toBe(false);
  });
});

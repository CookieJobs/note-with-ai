import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useCreateNote } from './useCreateNote';

const createdNote = {
  _id: 'note-1', content: '正文', contentText: '正文', contentJson: null, title: '正文',
  summary: '', concepts: [], keywords: [], recommendCache: null, revision: 1,
  createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
};

describe('useCreateNote', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('delegates a plain-text compose submission to createNote and clears only after success', async () => {
    const createNote = vi.fn().mockResolvedValue(createdNote);
    const { result } = renderHook(() => useCreateNote(createNote));

    await act(async () => {
      result.current.setNewContentText('正文');
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledWith({
      body: { kind: 'plain-text', text: '正文' },
      optimistic: { contentText: '正文', contentJson: null },
    });
    expect(result.current.newContentText).toBe('');
    expect(result.current.newContentJson).toBeNull();
  });

  it('delegates a rich-text document without creating its own HTTP request', async () => {
    const createNote = vi.fn().mockResolvedValue(createdNote);
    const richText = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '富文本正文' }] }],
    };
    const { result } = renderHook(() => useCreateNote(createNote));

    act(() => {
      result.current.setNewContentText('富文本正文');
      result.current.setNewContentJson(richText);
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(createNote).toHaveBeenCalledWith({
      body: { kind: 'rich-text', document: richText },
      optimistic: { contentText: '富文本正文', contentJson: richText },
    });
  });

  it('keeps compose input retryable and surfaces errors when createNote rejects', async () => {
    const createNote = vi.fn().mockRejectedValue(new Error('创建失败'));
    const onError = vi.fn();
    const richText = { type: 'doc', content: [] };
    const { result } = renderHook(() => useCreateNote(createNote, { onError }));

    act(() => {
      result.current.setNewContentText('仍需重试');
      result.current.setNewContentJson(richText);
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onError).toHaveBeenCalledWith('创建失败');
    expect(result.current.newContentText).toBe('仍需重试');
    expect(result.current.newContentJson).toEqual(richText);
  });

  it('restores text and formatting after leaving the page, isolated by account', () => {
    const createNote = vi.fn().mockResolvedValue(createdNote);
    const richText = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '未完成', marks: [{ type: 'bold' }] }] }] };
    const first = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    act(() => { first.result.current.setNewContentText('未完成'); first.result.current.setNewContentJson(richText); });
    first.unmount();
    const next = renderHook(({ userId }) => useCreateNote(createNote, { userId }), { initialProps: { userId: 'bob' } });
    expect(next.result.current.newContentText).toBe('');
    next.rerender({ userId: 'alice' });
    expect(next.result.current.newContentText).toBe('未完成');
    expect(next.result.current.newContentJson).toEqual(richText);
    expect(next.result.current.draftRestored).toBe(true);
  });

  it('recovers an unversioned draft without rewriting its original record', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已有草稿' }] }] };
    const raw = JSON.stringify({ text: '已有草稿', json });
    localStorage.setItem('quick-capture-draft:alice', raw);
    const { result } = renderHook(() => useCreateNote(vi.fn(), { userId: 'alice' }));
    expect(result.current.newContentText).toBe('已有草稿');
    expect(result.current.newContentJson).toEqual(json);
    expect(result.current.draftRestored).toBe(true);
    expect(localStorage.getItem('quick-capture-draft:alice')).toBe(raw);
  });

  it.each([
    { type: 'doc', content: [{ type: 'unknown' }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '文字', marks: [{ type: 'unknown' }] }] }] },
  ])('recovers text from a draft with invalid rich content', (json) => {
    const raw = JSON.stringify({ version: 1, text: '可恢复的文字', json });
    localStorage.setItem('quick-capture-draft:alice', raw);
    const { result } = renderHook(() => useCreateNote(vi.fn(), { userId: 'alice' }));
    expect(result.current.newContentText).toBe('可恢复的文字');
    expect(result.current.newContentJson).toBeNull();
    expect(result.current.saveError).toContain('格式无法恢复');
    expect(localStorage.getItem('quick-capture-draft:alice')).toBe(raw);
  });

  it('retains a failed save across remount and clears the persisted draft only after a successful retry', async () => {
    const createNote = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(createdNote);
    const first = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    act(() => first.result.current.setNewContentText('断网时的想法'));
    await act(async () => { expect(await first.result.current.handleSubmit()).toBe(false); });
    expect(first.result.current.saveState).toBe('failed');
    first.unmount();
    const next = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    expect(next.result.current.newContentText).toBe('断网时的想法');
    await act(async () => { expect(await next.result.current.handleSubmit()).toBe(true); });
    expect(next.result.current.saveState).toBe('saved');
    next.unmount();
    const afterSave = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    expect(afterSave.result.current.newContentText).toBe('');
  });

  it('does not erase newer input when an earlier save completes', async () => {
    let resolve!: (note: typeof createdNote) => void;
    const createNote = vi.fn(() => new Promise<typeof createdNote>(done => { resolve = done; }));
    const view = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    act(() => view.result.current.setNewContentText('第一条'));
    let pending!: Promise<boolean>;
    act(() => { pending = view.result.current.handleSubmit(); });
    act(() => view.result.current.setNewContentText('正在补充的新内容'));
    await act(async () => { resolve(createdNote); expect(await pending).toBe(false); });
    expect(view.result.current.newContentText).toBe('正在补充的新内容');
    view.unmount();
    const restored = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    expect(restored.result.current.newContentText).toBe('正在补充的新内容');
  });

  it('blocks duplicate submissions in the same tick', async () => {
    const completions: Array<(note: typeof createdNote) => void> = [];
    const createNote = vi.fn(() => new Promise<typeof createdNote>(done => { completions.push(done); }));
    const view = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    act(() => view.result.current.setNewContentText('只保存一次'));
    let second: boolean | undefined;
    await act(async () => {
      const first = view.result.current.handleSubmit();
      const duplicate = view.result.current.handleSubmit();
      completions.forEach(done => done(createdNote));
      await first;
      second = await duplicate;
    });
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(second).toBe(false);
  });

  it('does not clear another account when an old request finishes', async () => {
    let resolve!: (note: typeof createdNote) => void;
    const createNote = vi.fn(() => new Promise<typeof createdNote>(done => { resolve = done; }));
    const view = renderHook(({ userId }) => useCreateNote(createNote, { userId }), { initialProps: { userId: 'alice' } });
    act(() => view.result.current.setNewContentText('Alice 的内容'));
    let pending!: Promise<boolean>;
    act(() => { pending = view.result.current.handleSubmit(); });
    view.rerender({ userId: 'bob' });
    act(() => view.result.current.setNewContentText('Bob 的内容'));
    await act(async () => { resolve(createdNote); expect(await pending).toBe(false); });
    expect(view.result.current.newContentText).toBe('Bob 的内容');
    expect(view.result.current.saveState).toBe('idle');
  });

  it('allows saving when local storage is unavailable without claiming the draft is safe', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const view = renderHook(() => useCreateNote(vi.fn().mockResolvedValue(createdNote), { userId: 'alice' }));
    act(() => view.result.current.setNewContentText('仍然可以保存'));
    expect(view.result.current.localDraftState).toBe('unavailable');
    expect(view.result.current.newContentText).toBe('仍然可以保存');
    await act(async () => { expect(await view.result.current.handleSubmit()).toBe(true); });
  });

  it('explicitly discards a draft so it is not restored', () => {
    const createNote = vi.fn().mockResolvedValue(createdNote);
    const view = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    act(() => view.result.current.setNewContentText('放弃的内容'));
    act(() => view.result.current.discardDraft());
    expect(view.result.current.newContentText).toBe('');
    view.unmount();
    const next = renderHook(() => useCreateNote(createNote, { userId: 'alice' }));
    expect(next.result.current.newContentText).toBe('');
  });
});

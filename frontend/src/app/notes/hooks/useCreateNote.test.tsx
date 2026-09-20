import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useCreateNote } from './useCreateNote';

const createdNote = {
  _id: 'note-1', content: '正文', contentText: '正文', contentJson: null, title: '正文',
  summary: '', concepts: [], keywords: [], recommendCache: null, revision: 1,
  createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
};

describe('useCreateNote', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('restores only the signed-in user\'s persisted draft after remount', async () => {
    localStorage.setItem('quick-capture-draft:user-a', JSON.stringify({
      version: 1, text: '继续写', json: null,
    }));
    localStorage.setItem('quick-capture-draft:user-b', JSON.stringify({
      version: 1, text: '不该出现', json: null,
    }));
    const createNote = vi.fn().mockResolvedValue(createdNote);

    const { result } = renderHook(() => useCreateNote(createNote, { userId: 'user-a' }));

    await act(async () => undefined);

    expect(result.current.newContentText).toBe('继续写');
    expect(result.current.draftRestored).toBe(true);
    expect(result.current.localDraftState).toBe('saved');
  });

  it('falls back to persisted text when rich-text JSON is invalid', async () => {
    localStorage.setItem('quick-capture-draft:user-a', JSON.stringify({
      version: 1, text: '保住文字', json: { type: 'not-a-doc' },
    }));
    const createNote = vi.fn().mockResolvedValue(createdNote);

    const { result } = renderHook(() => useCreateNote(createNote, { userId: 'user-a' }));

    await act(async () => undefined);

    expect(result.current.newContentText).toBe('保住文字');
    expect(result.current.newContentJson).toBeNull();
    expect(result.current.saveError).toContain('格式');
  });

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

  it('keeps text and reports failed state when saving rejects', async () => {
    const createNote = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCreateNote(createNote, { userId: 'user-a' }));

    act(() => result.current.setNewContentText('不要丢'));
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.newContentText).toBe('不要丢');
    expect(result.current.saveState).toBe('failed');
    expect(localStorage.getItem('quick-capture-draft:user-a')).toContain('不要丢');
  });

  it('does not clear text typed after an earlier save began', async () => {
    let resolveSave: ((note: typeof createdNote) => void) | undefined;
    const createNote = vi.fn().mockImplementation(() => new Promise<typeof createdNote>((resolve) => {
      resolveSave = resolve;
    }));
    const { result } = renderHook(() => useCreateNote(createNote, { userId: 'user-a' }));

    act(() => result.current.setNewContentText('第一段'));
    let submit: Promise<boolean> | undefined;
    act(() => {
      submit = result.current.handleSubmit();
    });
    act(() => result.current.setNewContentText('第一段，继续写'));
    await act(async () => {
      resolveSave?.(createdNote);
      await submit;
    });

    expect(result.current.newContentText).toBe('第一段，继续写');
    expect(localStorage.getItem('quick-capture-draft:user-a')).toContain('第一段，继续写');
  });
});

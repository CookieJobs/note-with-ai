import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useCreateNote } from './useCreateNote';

const createdNote = {
  _id: 'note-1', content: '正文', contentText: '正文', contentJson: null, title: '正文',
  summary: '', concepts: [], keywords: [], recommendCache: null, revision: 1,
  createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
};

describe('useCreateNote', () => {
  beforeEach(() => vi.restoreAllMocks());

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
});

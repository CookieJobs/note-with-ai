import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNoteTitleSuggestion } from './useNoteTitleSuggestion';

const { suggestNoteTitle } = vi.hoisted(() => ({ suggestNoteTitle: vi.fn() }));
vi.mock('../services/noteTitleSuggestions', () => ({ suggestNoteTitle }));

const response = (title: string) => ({ title, clientRequestId: 'unused', sourceFingerprint: 'a'.repeat(64) });

describe('useNoteTitleSuggestion', () => {
  afterEach(() => { vi.useRealTimers(); suggestNoteTitle.mockReset(); });
  it('ignores an old response after body ABA and permits an immediate new request', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    suggestNoteTitle.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(response('最新'));
    let body = 'A';
    const apply = vi.fn();
    const { result } = renderHook(() => useNoteTitleSuggestion({ userId: 'u', editorSessionId: 'n', open: true,
      getBody: () => ({ kind: 'plain-text', text: body }), getTitle: () => '', onApply: apply }));
    let first!: Promise<void>;
    act(() => { first = result.current.generate(); void result.current.generate(); });
    expect(suggestNoteTitle).toHaveBeenCalledTimes(1);
    act(() => { body = 'B'; result.current.invalidate('body'); body = 'A'; result.current.invalidate('body'); });
    await act(async () => { await result.current.generate(); });
    await act(async () => { finish(response('旧结果')); await first; });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('最新');
    expect(result.current.state).toBe('idle');
  });

  it('does not let a stale failure or finally clear a newer request', async () => {
    let rejectOld!: (reason: Error) => void;
    let finishNew!: (value: ReturnType<typeof response>) => void;
    suggestNoteTitle.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    const apply = vi.fn();
    const { result } = renderHook(() => useNoteTitleSuggestion({ userId: 'u', editorSessionId: 'n', open: true,
      getBody: () => ({ kind: 'plain-text', text: '正文' }), getTitle: () => '', onApply: apply }));
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.generate(); result.current.invalidate('title'); second = result.current.generate(); });
    await act(async () => { rejectOld(new Error('old')); await first; });
    expect(result.current.state).toBe('generating');
    expect(result.current.error).toBe('');
    await act(async () => { finishNew(response('建议')); await second; });
    expect(apply).toHaveBeenCalledWith('建议');
  });

  it('ends a request after the frontend deadline even if the provider ignores abort', async () => {
    vi.useFakeTimers();
    suggestNoteTitle.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useNoteTitleSuggestion({ userId: 'u', editorSessionId: 'n', open: true,
      getBody: () => ({ kind: 'plain-text', text: '正文' }), getTitle: () => '', onApply: vi.fn() }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.generate(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(32_000); await pending; });
    expect(result.current.state).toBe('failed');
    expect(result.current.error).toContain('超时');
  });

  it('undoes an accepted suggestion into the draft and invalidates undo after manual editing', async () => {
    suggestNoteTitle.mockResolvedValue(response('建议标题'));
    let title = '手写标题';
    const apply = vi.fn((next: string) => { title = next; });
    const { result } = renderHook(() => useNoteTitleSuggestion({ userId: 'u', editorSessionId: 'n', open: true,
      getBody: () => ({ kind: 'plain-text', text: '正文' }), getTitle: () => title, onApply: apply }));
    await act(async () => { await result.current.generate(); });
    expect(title).toBe('建议标题');
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undoSuggestion());
    expect(title).toBe('手写标题');
    expect(result.current.canUndo).toBe(false);
    await act(async () => { await result.current.generate(); });
    act(() => result.current.invalidate('title'));
    act(() => result.current.undoSuggestion());
    expect(title).toBe('建议标题');
  });

  it('keeps the previous title recoverable after editing only the body', async () => {
    suggestNoteTitle.mockResolvedValue(response('建议标题'));
    let title = '手写标题';
    const { result } = renderHook(() => useNoteTitleSuggestion({ userId: 'u', editorSessionId: 'n', open: true,
      getBody: () => ({ kind: 'plain-text', text: '正文' }), getTitle: () => title, onApply: (next) => { title = next; } }));
    await act(async () => { await result.current.generate(); });
    act(() => result.current.invalidate('body'));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undoSuggestion());
    expect(title).toBe('手写标题');
    expect(result.current.canUndo).toBe(false);
  });
});

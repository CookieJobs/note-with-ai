import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuickCaptureDraft } from './useQuickCaptureDraft';

describe('useQuickCaptureDraft', () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('persists and restores a user-isolated draft without mixing relationship context into the body', async () => {
    vi.useFakeTimers();
    const first = renderHook(() => useQuickCaptureDraft('user-1'));

    act(() => {
      first.result.current.saveDraft({
        text: '继续观察这个变化',
        title: '回望',
        editorMode: 'plain',
        context: { origin: 'relationship', relationshipId: 'relationship:note-a:3:note-b:1', sourceNoteIds: ['note-a', 'note-b'] },
      });
      vi.advanceTimersByTime(500);
    });
    first.unmount();

    const second = renderHook(() => useQuickCaptureDraft('user-1'));
    expect(second.result.current.draft?.text).toBe('继续观察这个变化');
    expect(second.result.current.draft?.context?.relationshipId).toBe('relationship:note-a:3:note-b:1');
    expect(second.result.current.draft?.text).not.toContain('note-a');
  });

  it('clears only when explicitly asked, allowing failed saves to retain the draft', () => {
    const hook = renderHook(() => useQuickCaptureDraft('user-2'));
    act(() => hook.result.current.saveDraft({ text: '还没保存', editorMode: 'plain' }));
    expect(hook.result.current.draft?.text).toBe('还没保存');
    act(() => hook.result.current.clearDraft());
    expect(hook.result.current.draft).toBeNull();
  });
});

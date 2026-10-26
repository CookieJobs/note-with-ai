import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { WorkspacePopstateBridgeContext } from './WorkspacePopstateBridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEditor } from './WorkspaceContext';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function editor(initialDirty = true) {
  const state = { dirty: initialDirty, saving: false };
  const contract: WorkspaceEditor = {
    isDirty: () => state.dirty,
    isSaving: () => state.saving,
    save: vi.fn(async () => { state.dirty = false; return true; }),
    discard: vi.fn(() => { state.dirty = false; }),
    focus: vi.fn(),
  };
  return { state, contract };
}

async function renderNavigation() {
  const hook = renderHook(useWorkspaceNavigation);
  await act(async () => {});
  return hook;
}

beforeEach(() => {
  push.mockReset();
  window.history.replaceState({ __NA: true, tree: 'preserved' }, '', '/notes');
});
afterEach(cleanup);

describe('workspace navigation', () => {
  it('executes clean actions immediately and observes fresh dirty getters', async () => {
    const { result } = await renderNavigation();
    const draft = editor(false);
    act(() => { result.current.registerEditor(draft.contract); result.current.navigate('/inspirations'); });
    expect(push).toHaveBeenCalledWith('/inspirations');
    draft.state.dirty = true;
    act(() => result.current.navigate('/profile'));
    expect(result.current.pending).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('cancel keeps the draft and restores the triggering focus', async () => {
    const { result } = await renderNavigation();
    const draft = editor();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    act(() => { result.current.registerEditor(draft.contract); result.current.navigate('/profile'); });
    act(() => result.current.cancel());
    expect(result.current.pending).toBe(false);
    expect(draft.state.dirty).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(draft.contract.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('discards once and executes the first queued action, ignoring a repeated target', async () => {
    const { result } = await renderNavigation();
    const draft = editor();
    act(() => {
      result.current.registerEditor(draft.contract);
      result.current.navigate('/inspirations');
      result.current.navigate('/profile');
      result.current.discardAndContinue();
    });
    expect(push).toHaveBeenCalledExactlyOnceWith('/inspirations');
    expect(draft.contract.discard).toHaveBeenCalledOnce();
    expect(result.current.pending).toBe(false);
  });

  it('does not leave when discard refuses', async () => {
    const { result } = await renderNavigation();
    const draft = editor();
    draft.contract.discard = () => false;
    act(() => { result.current.registerEditor(draft.contract); result.current.navigate('/profile'); result.current.discardAndContinue(); });
    expect(result.current.pending).toBe(true);
    expect(result.current.error).not.toBe('');
    expect(push).not.toHaveBeenCalled();
  });

  it('saves successfully before executing the queued action', async () => {
    const { result } = await renderNavigation();
    const draft = editor();
    act(() => { result.current.registerEditor(draft.contract); result.current.navigate('/profile'); });
    await act(() => result.current.saveAndContinue());
    expect(draft.contract.save).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledExactlyOnceWith('/profile');
    expect(result.current.pending).toBe(false);
  });

  it.each(['false', 'throw', 'later-edit'])('keeps the editor and queued action after save %s', async (mode) => {
    const { result } = await renderNavigation();
    const draft = editor();
    draft.contract.save = async () => { if (mode === 'throw') throw new Error('network'); return mode === 'later-edit'; };
    act(() => { result.current.registerEditor(draft.contract); result.current.navigate('/profile'); });
    await act(() => result.current.saveAndContinue());
    expect(result.current.pending).toBe(true);
    expect(result.current.error).not.toBe('');
    expect(result.current.busy).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('blocks already saving editors and prevents concurrent save and discard', async () => {
    const { result } = await renderNavigation();
    const draft = editor(false);
    draft.state.saving = true;
    act(() => { result.current.registerEditor(draft.contract); result.current.navigate('/profile'); });
    await act(() => result.current.saveAndContinue());
    act(() => result.current.discardAndContinue());
    expect(draft.contract.save).not.toHaveBeenCalled();
    expect(draft.contract.discard).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    draft.state.saving = false;
    draft.state.dirty = true;
    let resolveSave!: (saved: boolean) => void;
    draft.contract.save = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve; }));
    let firstSave!: Promise<void>;
    act(() => { firstSave = result.current.saveAndContinue(); });
    expect(result.current.busy).toBe(true);
    await act(() => result.current.saveAndContinue());
    act(() => { result.current.discardAndContinue(); result.current.navigate('/inspirations'); });
    expect(draft.contract.save).toHaveBeenCalledOnce();
    draft.state.dirty = false;
    await act(async () => { resolveSave(true); await firstSave; });
    expect(push).toHaveBeenCalledExactlyOnceWith('/profile');
  });

  it('old editor cleanup cannot unregister a newer editor', async () => {
    const { result } = await renderNavigation();
    const older = editor(false);
    const newer = editor();
    act(() => {
      const unregister = result.current.registerEditor(older.contract);
      result.current.registerEditor(newer.contract);
      unregister();
      result.current.navigate('/profile');
    });
    expect(result.current.pending).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it('re-registering the same editor object still owns a distinct cleanup token', async () => {
    const { result } = await renderNavigation();
    const draft = editor();
    act(() => {
      const unregister = result.current.registerEditor(draft.contract);
      result.current.registerEditor(draft.contract);
      unregister();
      result.current.navigate('/profile');
    });
    expect(result.current.pending).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it('stale save completion cannot execute a newer pending action', async () => {
    const { result } = await renderNavigation();
    const older = editor();
    let resolveSave!: (saved: boolean) => void;
    older.contract.save = () => new Promise<boolean>((resolve) => { resolveSave = resolve; });
    let unregister!: () => void;
    act(() => { unregister = result.current.registerEditor(older.contract); result.current.navigate('/profile'); });
    let saving!: Promise<void>;
    act(() => { saving = result.current.saveAndContinue(); });
    act(() => { unregister(); result.current.registerEditor(editor().contract); });
    await act(async () => { older.state.dirty = false; resolveSave(true); await saving; });
    expect(push).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(true);
  });

  it('protects beforeunload only while the registered editor is dirty or saving', async () => {
    const { result, unmount } = await renderNavigation();
    const draft = editor();
    act(() => { result.current.registerEditor(draft.contract); });
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    draft.state.dirty = false;
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    draft.state.saving = true;
    const savingUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(savingUnload);
    expect(savingUnload.defaultPrevented).toBe(true);
    unmount();
    draft.state.dirty = true;
    const laterUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(laterUnload);
    expect(laterUnload.defaultPrevented).toBe(false);
  });
});

describe('browser history protection', () => {
  it('subscribes the active guard to the early bridge instead of requiring a late window event', async () => {
    let subscriber: ((event: PopStateEvent) => void) | undefined;
    const bridge = { subscribe: (handler: (event: PopStateEvent) => void) => {
      subscriber = handler;
      return () => { subscriber = undefined; };
    } };
    const originalReplace = history.replaceState;
    const { result, unmount } = renderHook(useWorkspaceNavigation, {
      wrapper: ({ children }) => <WorkspacePopstateBridgeContext.Provider value={bridge}>{children}</WorkspacePopstateBridgeContext.Provider>,
    });
    await act(async () => {});
    act(() => {
      result.current.registerEditor(editor().contract);
      originalReplace.call(history, null, '', '/auth');
      subscriber?.(new PopStateEvent('popstate', { state: null }));
    });
    expect(location.pathname).toBe('/notes');
    expect(result.current.pending).toBe(true);
    unmount();
    expect(subscriber).toBeUndefined();
  });

  it('keeps a failed browser-back save on the restored editing entry', async () => {
    const { result } = await renderNavigation();
    const draft = editor();
    draft.contract.save = async () => false;
    const nextPop = vi.fn();
    window.addEventListener('popstate', nextPop);
    act(() => {
      history.pushState({ __NA: true }, '', '/notes?edit');
      result.current.registerEditor(draft.contract);
      history.back();
    });
    await waitFor(() => expect(result.current.pending && location.search === '?edit').toBe(true));
    await act(() => result.current.saveAndContinue());
    expect(location.search).toBe('?edit');
    expect(result.current.pending).toBe(true);
    expect(result.current.error).not.toBe('');
    expect(nextPop).not.toHaveBeenCalled();
    window.removeEventListener('popstate', nextPop);
  });

  it('does not leave a stale wrapper when the App Router installs its parent effect later', async () => {
    const nativePush = history.pushState;
    function NextRouter({ children }: { children: ReactNode }) {
      useEffect(() => {
        const inner = history.pushState;
        history.pushState = function (state, unused, url) { inner.call(history, state, unused, url); };
        return () => { history.pushState = nativePush; };
      }, []);
      return children;
    }
    function Guard() { useWorkspaceNavigation(); return null; }
    const view = render(<NextRouter><Guard /></NextRouter>);
    await act(async () => {});
    view.rerender(<NextRouter>{null}</NextRouter>);
    history.pushState({ __NA: true, afterUnmount: true }, '', '/profile');
    expect(history.state).toEqual({ __NA: true, afterUnmount: true });
  });

  it('restores back before Next receives it, cancels, then replays back and forward', async () => {
    const { result } = await renderNavigation();
    const draft = editor();
    const nextPop = vi.fn();
    window.addEventListener('popstate', nextPop);
    act(() => {
      window.history.pushState({ __NA: true, tree: 'one' }, '', '/notes?one');
      window.history.pushState({ __NA: true, tree: 'two' }, '', '/notes?two');
      result.current.registerEditor(draft.contract);
      window.history.back();
    });
    await waitFor(() => expect(result.current.pending && location.search === '?two').toBe(true));
    expect(nextPop).not.toHaveBeenCalled();
    act(() => result.current.cancel());
    expect(location.search).toBe('?two');
    act(() => window.history.back());
    await waitFor(() => expect(result.current.pending && location.search === '?two').toBe(true));
    act(() => result.current.discardAndContinue());
    await waitFor(() => expect(location.search).toBe('?one'));
    await waitFor(() => expect(nextPop).toHaveBeenCalledTimes(1));
    draft.state.dirty = true;
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.pending && location.search === '?one').toBe(true));
    expect(nextPop).toHaveBeenCalledTimes(1);
    await act(() => result.current.saveAndContinue());
    await waitFor(() => expect(location.search).toBe('?two'));
    await waitFor(() => expect(nextPop).toHaveBeenCalledTimes(2));
    expect(window.history.state).toMatchObject({ __NA: true, tree: 'two' });
    window.removeEventListener('popstate', nextPop);
  });

  it('restores current URL for unknown history without exposing its route to Next', async () => {
    const nativeReplace = history.replaceState;
    const { result } = await renderNavigation();
    const draft = editor();
    const currentState = history.state;
    act(() => { result.current.registerEditor(draft.contract); });
    // Simulate a same-document entry created before workspace instrumentation.
    act(() => {
      nativeReplace.call(history, null, '', '/auth');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    expect(location.pathname).toBe('/notes');
    expect(history.state).toEqual(currentState);
    expect(result.current.pending).toBe(true);
    act(() => result.current.discardAndContinue());
    expect(push).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/auth');
  });

  it('preserves Next state and restores original history methods on cleanup', async () => {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const { unmount } = await renderNavigation();
    history.replaceState({ __NA: true, tree: 'new' }, '', '/notes?replace');
    expect(history.state).toMatchObject({ __NA: true, tree: 'new' });
    unmount();
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
  });

  it('cancels deferred installation if unmounted before the first microtask', async () => {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const { unmount } = renderHook(useWorkspaceNavigation);
    unmount();
    await act(async () => {});
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
  });
});

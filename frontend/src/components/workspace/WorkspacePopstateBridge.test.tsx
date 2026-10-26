import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { useContext, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePopstateBridgeContext, WorkspacePopstateBridge } from './WorkspacePopstateBridge';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => history.replaceState({ __NA: true }, '', '/auth'));
afterEach(cleanup);

describe('early workspace popstate bridge', () => {
  it('owns no history mutation or navigation subscription on excluded routes', () => {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const next = vi.fn();
    const view = render(<WorkspacePopstateBridge><p>auth</p></WorkspacePopstateBridge>);
    window.addEventListener('popstate', next);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    expect(next).toHaveBeenCalledOnce();
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
    view.unmount();
    window.removeEventListener('popstate', next);
  });

  it('forwards to a late subscriber and old cleanup cannot clear the newer subscriber', () => {
    const { result, unmount } = renderHook(() => useContext(WorkspacePopstateBridgeContext), {
      wrapper: ({ children }) => <WorkspacePopstateBridge>{children}</WorkspacePopstateBridge>,
    });
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = result.current!.subscribe(first);
    const releaseSecond = result.current!.subscribe(second);
    releaseFirst();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    releaseSecond();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(second).toHaveBeenCalledOnce();
    const activeAtUnmount = vi.fn();
    result.current!.subscribe(activeAtUnmount);
    unmount();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(second).toHaveBeenCalledOnce();
    expect(activeAtUnmount).not.toHaveBeenCalled();
  });

  it('protects workspace mounted after auth and releases the guard when workspace leaves', async () => {
    let navigation: ReturnType<typeof useWorkspaceNavigation> | undefined;
    const next = vi.fn();
    function NextRouter({ children }: { children: ReactNode }) {
      useEffect(() => {
        window.addEventListener('popstate', next);
        return () => window.removeEventListener('popstate', next);
      }, []);
      return children;
    }
    function Workspace() {
      navigation = useWorkspaceNavigation();
      return <p>workspace</p>;
    }
    function App({ workspace }: { workspace: boolean }) {
      return <NextRouter><WorkspacePopstateBridge>{workspace ? <Workspace /> : <p>auth</p>}</WorkspacePopstateBridge></NextRouter>;
    }
    const view = render(<App workspace={false} />);
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    // Next already owns its listener when auth pushes the workspace route.
    history.pushState({ __NA: true }, '', '/notes');
    view.rerender(<App workspace />);
    await act(async () => {});
    act(() => {
      history.pushState({ __NA: true }, '', '/notes?reading');
      navigation!.registerEditor({ isDirty: () => true, isSaving: () => false, save: async () => false, discard: () => true });
      history.back();
    });
    await waitFor(() => expect(navigation!.pending && location.search === '?reading').toBe(true));
    expect(next).not.toHaveBeenCalled();
    act(() => navigation!.cancel());
    view.rerender(<App workspace={false} />);
    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    expect(next).toHaveBeenCalledOnce();
    view.unmount();
  });
});

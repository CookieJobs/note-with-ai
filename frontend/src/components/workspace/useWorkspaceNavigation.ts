/*
Input: 最新编辑器 getter、程序导航和浏览器历史遍历
Output: 唯一待执行动作及公共离开确认状态
Pos: frontend/src/components/workspace
Note: 修改时同步本目录 README。
*/
'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkspaceEditor } from './WorkspaceContext';
import { WorkspacePopstateBridgeContext } from './WorkspacePopstateBridge';

const HISTORY_KEY = '__noteWithAIWorkspace';
type Position = { session: string; index: number };
type RegisteredEditor = { editor: WorkspaceEditor };
type PendingAction = { run: () => void; trigger: HTMLElement | null };

function positionOf(state: unknown): Position | null {
  if (!state || typeof state !== 'object') return null;
  const marker = (state as Record<string, unknown>)[HISTORY_KEY] as Partial<Position> | undefined;
  return marker && typeof marker.session === 'string' && Number.isSafeInteger(marker.index)
    ? marker as Position : null;
}

function withPosition(state: unknown, position: Position) {
  return { ...(state && typeof state === 'object' ? state : {}), [HISTORY_KEY]: position };
}

export function useWorkspaceNavigation(): {
  navigate: (href: string) => void;
  requestAction: (action: () => void) => void;
  registerEditor: (editor: WorkspaceEditor) => () => void;
  pending: boolean;
  busy: boolean;
  error: string;
  saveAndContinue: () => Promise<void>;
  discardAndContinue: () => void;
  cancel: () => void;
} {
  const router = useRouter();
  const popstateBridge = useContext(WorkspacePopstateBridgeContext);
  const routerRef = useRef(router);
  routerRef.current = router;
  const editorRef = useRef<RegisteredEditor | null>(null);
  const pendingRef = useRef<PendingAction | null>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const registerEditor = useCallback((editor: WorkspaceEditor) => {
    const registration = { editor };
    editorRef.current = registration;
    return () => {
      if (editorRef.current === registration) editorRef.current = null;
    };
  }, []);

  const requestAction = useCallback((run: () => void) => {
    // A ref closes the same-event gap before React renders the dialog.
    if (pendingRef.current || savingRef.current) return;
    const editor = editorRef.current?.editor;
    if (!editor || (!editor.isDirty() && !editor.isSaving())) {
      run();
      return;
    }
    const trigger = document.activeElement;
    pendingRef.current = { run, trigger: trigger instanceof HTMLElement && trigger !== document.body ? trigger : null };
    setError('');
    setPending(true);
  }, []);

  const navigate = useCallback((href: string) => {
    requestAction(() => routerRef.current.push(href));
  }, [requestAction]);

  const complete = useCallback((action: PendingAction) => {
    if (!mountedRef.current || pendingRef.current !== action) return;
    pendingRef.current = null;
    setPending(false);
    setError('');
    action.run();
  }, []);

  const saveAndContinue = useCallback(async () => {
    const action = pendingRef.current;
    if (!action || savingRef.current) return;
    const registration = editorRef.current;
    const editor = registration?.editor;
    if (editor?.isSaving()) { setError('正在保存，请稍后重试。'); return; }
    if (!editor) { complete(action); return; }
    savingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await editor.save();
      if (!mountedRef.current || pendingRef.current !== action) return;
      if (editorRef.current !== registration) {
        setError('编辑内容已发生变化，请重新确认。');
      } else if (saved && !editor.isDirty() && !editor.isSaving()) {
        complete(action);
      } else {
        setError('未能完成保存，或仍有新的修改，请检查后重试。');
      }
    } catch {
      if (mountedRef.current && pendingRef.current === action) setError('保存失败，请检查后重试。');
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [complete]);

  const discardAndContinue = useCallback(() => {
    const action = pendingRef.current;
    const editor = editorRef.current?.editor;
    if (!action || savingRef.current) return;
    if (editor?.isSaving()) { setError('正在保存，请稍后重试。'); return; }
    try {
      if (editor?.discard() === false) { setError('无法放弃当前修改，请重试。'); return; }
      complete(action);
    } catch {
      setError('无法放弃当前修改，请重试。');
    }
  }, [complete]);

  const cancel = useCallback(() => {
    if (savingRef.current) return;
    const action = pendingRef.current;
    pendingRef.current = null;
    setPending(false);
    setError('');
    editorRef.current?.editor.focus?.();
    if (action?.trigger?.isConnected) action.trigger.focus();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const history = window.history;
    let originalPush = history.pushState;
    let originalReplace = history.replaceState;
    let active = true;
    let current = positionOf(history.state) ?? { session: crypto.randomUUID(), index: 0 };
    let currentUrl = window.location.href;
    let currentState = withPosition(history.state, current);
    // __NA and Next's private tree remain untouched, so this does not dispatch
    // an App Router restore when passed through Next's history wrapper.
    originalReplace.call(history, currentState, '', currentUrl);
    let rollback: { position: Position; after?: () => void } | null = null;
    let replay: Position | null = null;

    const remember = (position: Position) => {
      current = position;
      currentUrl = window.location.href;
      currentState = history.state;
    };
    const patchedPush: History['pushState'] = function (data, unused, url) {
      const next = { session: current.session, index: current.index + 1 };
      originalPush.call(history, withPosition(data, next), unused, url);
      remember(next);
    };
    const patchedReplace: History['replaceState'] = function (data, unused, url) {
      originalReplace.call(history, withPosition(data, current), unused, url);
      remember(current);
    };
    // Child effects run before App Router's parent effect on the initial commit.
    // Install after that effect so cleanup restores Next's wrappers rather than
    // leaving an unmounted workspace wrapper captured inside Next's closure.
    queueMicrotask(() => {
      if (!active) return;
      originalPush = history.pushState;
      originalReplace = history.replaceState;
      currentState = withPosition(history.state, current);
      originalReplace.call(history, currentState, '', window.location.href);
      currentUrl = window.location.href;
      history.pushState = patchedPush;
      history.replaceState = patchedReplace;
    });

    const beforeUnload = (event: BeforeUnloadEvent) => {
      const editor = editorRef.current?.editor;
      if (savingRef.current || editor?.isDirty() || editor?.isSaving()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    const onPopState = (event: PopStateEvent) => {
      const target = positionOf(event.state);
      const sameSession = target?.session === current.session;
      if (rollback) {
        event.stopImmediatePropagation();
        if (sameSession && target.index === rollback.position.index) {
          const after = rollback.after;
          rollback = null;
          remember(target);
          after?.();
        } else if (sameSession) {
          history.go(rollback.position.index - target.index);
        } else {
          // Unexpected uninstrumented traversals must still preserve the draft.
          originalReplace.call(history, currentState, '', currentUrl);
          const after = rollback.after;
          rollback = null;
          after?.();
        }
        return;
      }
      if (replay && sameSession && target.index === replay.index) {
        replay = null;
        remember(target);
        return; // Only the explicitly confirmed traversal reaches Next.
      }
      replay = null;
      const editor = editorRef.current?.editor;
      const blocked = pendingRef.current || savingRef.current || editor?.isDirty() || editor?.isSaving();
      if (!blocked) {
        if (sameSession) remember(target);
        else {
          current = { session: crypto.randomUUID(), index: 0 };
          originalReplace.call(history, withPosition(event.state, current), '', window.location.href);
          remember(current);
        }
        return;
      }
      // Capture runs before Next's ordinary popstate listener can unmount us.
      event.stopImmediatePropagation();
      const targetUrl = window.location.href;
      if (sameSession && target.index !== current.index) {
        const delta = target.index - current.index;
        rollback = { position: current };
        history.go(-delta);
        requestAction(() => {
          const proceed = () => { replay = target; history.go(delta); };
          if (rollback) rollback.after = proceed;
          else proceed();
        });
      } else {
        // History exposes no direction/index for entries created before mount.
        // Restore the visible URL and Next state immediately; confirming pushes
        // the captured URL. This sacrifices that unknown entry, never the draft.
        originalReplace.call(history, currentState, '', currentUrl);
        requestAction(() => routerRef.current.push(targetUrl));
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    // A workspace may mount after auth while Next already owns its listener.
    // The persistent root bridge forwards before that listener can synchronously
    // commit a restored route and unregister this editor. Isolated consumers
    // without the root boundary retain their own capture listener.
    const releasePopstate = popstateBridge?.subscribe(onPopState);
    if (!popstateBridge) window.addEventListener('popstate', onPopState, true);
    return () => {
      active = false;
      mountedRef.current = false;
      window.removeEventListener('beforeunload', beforeUnload);
      releasePopstate?.();
      if (!popstateBridge) window.removeEventListener('popstate', onPopState, true);
      if (history.pushState === patchedPush) history.pushState = originalPush;
      if (history.replaceState === patchedReplace) history.replaceState = originalReplace;
    };
  }, [requestAction, popstateBridge]);

  return { navigate, requestAction, registerEditor, pending, busy, error, saveAndContinue, discardAndContinue, cancel };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../../../utils/auth';
import type { Note } from './useNotes';
import type { IRecommendCache } from '../../../types';

export type FocusedMutation = { key: string; generation: number };

type FocusedState = {
  key: string;
  status: 'loading' | 'ready' | 'missing' | 'error';
  note?: Note;
};

export function useFocusedSourceNote(userId: string | null, noteId: string, inFeed: boolean) {
  const key = userId && noteId ? `${userId}:${noteId}` : '';
  const [state, setState] = useState<FocusedState | null>(null);
  const [retryNumber, setRetryNumber] = useState(0);
  const requestRef = useRef(0);
  const keyRef = useRef(key);
  const generationRef = useRef(0);
  const deletedKeysRef = useRef(new Set<string>());
  if (keyRef.current !== key) {
    keyRef.current = key;
    generationRef.current += 1;
  }

  useEffect(() => {
    if (!key || inFeed) {
      requestRef.current += 1;
      setState(null);
      return;
    }
    if (deletedKeysRef.current.has(key)) {
      setState({ key, status: 'missing' });
      return;
    }
    const request = ++requestRef.current;
    const controller = new AbortController();
    setState({ key, status: 'loading' });
    void (async () => {
      try {
        const response = await authFetch(`/api/notes/${encodeURIComponent(noteId)}`, { signal: controller.signal });
        if (response.status === 404) {
          if (request === requestRef.current && keyRef.current === key) setState({ key, status: 'missing' });
          return;
        }
        if (!response.ok) throw new Error('读取原笔记失败');
        const payload = await response.json();
        const note = payload?.data?.note as Note | undefined;
        if (!payload?.success || !note || note._id !== noteId) throw new Error('原笔记响应无效');
        if (request === requestRef.current && keyRef.current === key) setState({ key, status: 'ready', note });
      } catch {
        if (!controller.signal.aborted && request === requestRef.current && keyRef.current === key) setState({ key, status: 'error' });
      }
    })();
    return () => { controller.abort(); requestRef.current += 1; };
  }, [key, noteId, inFeed, retryNumber]);

  const captureMutation = useCallback((id: string): FocusedMutation | null => {
    if (!key || id !== noteId || keyRef.current !== key || deletedKeysRef.current.has(key)) return null;
    return { key, generation: generationRef.current };
  }, [key, noteId]);

  const ownsMutation = useCallback((token: FocusedMutation | null): boolean => (
    !!token && token.key === key && keyRef.current === key && token.generation === generationRef.current && !deletedKeysRef.current.has(key)
  ), [key]);

  const applyCanonical = useCallback((note: Note, token: FocusedMutation | null) => {
    if (note._id !== noteId || !ownsMutation(token)) return;
    requestRef.current += 1;
    setState((current) => current?.key === key && current.status === 'ready' && ownsMutation(token)
      ? { key, status: 'ready', note } : current);
  }, [key, noteId, ownsMutation]);

  const applyRecommendCache = useCallback((sourceRevision: number, recommendCache: IRecommendCache, token: FocusedMutation | null) => {
    if (!ownsMutation(token)) return;
    setState((current) => current?.key === key && current.status === 'ready' && current.note?.revision === sourceRevision && ownsMutation(token)
      ? { key, status: 'ready', note: { ...current.note, recommendCache } } : current);
  }, [key, ownsMutation]);

  const markUnavailable = useCallback((id: string) => {
    if (!key || id !== noteId || keyRef.current !== key) return;
    deletedKeysRef.current.add(key);
    generationRef.current += 1;
    requestRef.current += 1;
    setState({ key, status: 'missing' });
  }, [key, noteId]);

  const retry = useCallback(() => {
    if (!key || keyRef.current !== key) return;
    deletedKeysRef.current.delete(key);
    generationRef.current += 1;
    setRetryNumber((value) => value + 1);
  }, [key]);

  return {
    state: state?.key === key && !inFeed ? state : null,
    retry,
    captureMutation,
    applyCanonical,
    applyRecommendCache,
    markUnavailable,
  };
}

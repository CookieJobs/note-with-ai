import { useCallback, useEffect, useRef, useState } from 'react';
import { generateUUID } from '../utils/uuid';
import { suggestNoteTitle } from '../services/noteTitleSuggestions';
import type { NoteBodyInput } from '../app/notes/hooks/useNotes';

export type TitleSuggestionState = 'idle' | 'generating' | 'failed';
type Identity = { userId: string | null; editorSessionId: string; open: boolean };
type Options = Identity & {
  getBody: () => NoteBodyInput;
  getTitle: () => string;
  onApply: (title: string) => void;
};
type Active = Identity & { clientRequestId: string; bodyVersion: number; titleVersion: number; abort: AbortController };

export function useNoteTitleSuggestion(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<TitleSuggestionState>('idle');
  const [error, setError] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const versions = useRef({ body: 0, title: 0 });
  const active = useRef<Active | null>(null);
  const undo = useRef<{ previous: string; version: number } | null>(null);

  const invalidate = useCallback((field?: 'body' | 'title') => {
    if (field === 'body') versions.current.body += 1;
    if (field === 'title') versions.current.title += 1;
    active.current?.abort.abort();
    active.current = null;
    setState('idle');
    setError('');
    // Body edits invalidate in-flight requests, not an already accepted title.
    if (field !== 'body') {
      undo.current = null;
      setCanUndo(false);
    }
  }, []);

  useEffect(() => {
    invalidate();
  }, [options.userId, options.editorSessionId, options.open, invalidate]);
  useEffect(() => () => {
    active.current?.abort.abort();
    active.current = null;
  }, []);

  const generate = useCallback(async () => {
    const current = latest.current;
    if (!current.open || !current.userId || active.current) return;
    const request: Active = {
      userId: current.userId, editorSessionId: current.editorSessionId, open: current.open,
      clientRequestId: generateUUID(), bodyVersion: versions.current.body, titleVersion: versions.current.title,
      abort: new AbortController(),
    };
    const owns = () => active.current === request && latest.current.open && latest.current.userId === request.userId
      && latest.current.editorSessionId === request.editorSessionId && versions.current.body === request.bodyVersion
      && versions.current.title === request.titleVersion;
    active.current = request;
    setState('generating');
    setError('');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        request.abort.abort();
        reject(new Error('标题生成超时，请稍后重试。'));
      }, 32_000);
    });
    try {
      const suggestion = await Promise.race([
        suggestNoteTitle(current.getBody(), request.clientRequestId, request.abort.signal), deadline,
      ]);
      if (!owns()) return;
      const previous = current.getTitle();
      versions.current.title += 1;
      undo.current = { previous, version: versions.current.title };
      setCanUndo(true);
      current.onApply(suggestion.title);
      active.current = null;
      setState('idle');
    } catch (cause) {
      if (!owns()) return;
      setError(cause instanceof Error ? cause.message : '标题生成失败，请稍后重试。');
      setState('failed');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (active.current === request) {
        active.current = null;
        setState((currentState) => currentState === 'generating' ? 'idle' : currentState);
      }
    }
  }, []);

  const undoSuggestion = useCallback(() => {
    const previous = undo.current;
    if (!previous || previous.version !== versions.current.title) return;
    invalidate('title');
    latest.current.onApply(previous.previous);
  }, [invalidate]);

  return { state, error, canUndo, generate, invalidate, undoSuggestion };
}

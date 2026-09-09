import { useCallback, useEffect, useRef, useState } from 'react';
import { getSchema, type JSONContent } from '@tiptap/react';
import { createRichTextExtensions } from '../components/tiptap/richTextPreset';
import type { CreateNoteCommand, Note } from './useNotes';

type UseCreateNoteOptions = { userId?: string | null; onError?: (message: string) => void };
export type CaptureSaveState = 'idle' | 'saving' | 'saved' | 'failed';
export type LocalDraftState = 'empty' | 'saved' | 'unavailable';
type Content = { text: string; json: JSONContent | null };
type Session = Content & {
  userId: string | null;
  revision: number;
  storedValue: string | null;
  localDraftState: LocalDraftState;
  draftRestored: boolean;
  saveState: CaptureSaveState;
  savedNote: Note | null;
  error: string;
};

const draftKey = (userId: string) => `quick-capture-draft:${userId}`;
const emptySession = (userId: string | null): Session => ({
  userId, text: '', json: null, revision: 0, storedValue: null,
  localDraftState: 'empty', draftRestored: false, saveState: 'idle', savedNote: null, error: '',
});

// Reuse the viewer/editor schema instead of maintaining a second list of rich-text nodes.
let draftSchema: ReturnType<typeof getSchema> | undefined;
function restoreDraft(userId: string | null): Session {
  const session = emptySession(userId);
  if (!userId) return session;
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return session;
    const value = JSON.parse(raw);
    // Older local drafts used the same text/JSON fields without a version.
    if ((value?.version !== undefined && value.version !== 1) || typeof value?.text !== 'string') {
      throw new Error('Invalid draft');
    }
    let json = value.json;
    let error = '';
    if (json !== null) {
      try {
        if (json?.type !== 'doc') throw new Error('Invalid document');
        draftSchema ??= getSchema(createRichTextExtensions());
        draftSchema.nodeFromJSON(json).check();
      } catch {
        json = null;
        error = '草稿格式无法恢复，已保留文字内容，请检查后保存。';
      }
    }
    return { ...session, text: value.text, json, error, storedValue: raw,
      localDraftState: value.text.trim() ? 'saved' : 'empty', draftRestored: Boolean(value.text.trim()) };
  } catch {
    // Leave unreadable storage untouched; never present failed recovery as a safe empty draft.
    return { ...session, localDraftState: 'unavailable' };
  }
}

function persistDraft(session: Session) {
  if (!session.userId) return;
  try {
    const key = draftKey(session.userId);
    if (!session.text.trim()) {
      if (localStorage.getItem(key) === session.storedValue) localStorage.removeItem(key);
      session.storedValue = null;
      session.localDraftState = 'empty';
      return;
    }
    const raw = JSON.stringify({ version: 1, text: session.text, json: session.json, updatedAt: Date.now() });
    // Persist in the input handler so navigation/refresh cannot outrun a debounce or effect.
    localStorage.setItem(key, raw);
    session.storedValue = raw;
    session.localDraftState = 'saved';
  } catch {
    session.localDraftState = 'unavailable';
  }
}

function removeStoredDraft(session: Session): boolean {
  if (!session.userId) return true;
  try {
    const key = draftKey(session.userId);
    // An old tab's save must not remove a newer draft from another tab.
    if (localStorage.getItem(key) === session.storedValue) localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function useCreateNote(
  createNote: (command: CreateNoteCommand) => Promise<Note>,
  { userId = null, onError }: UseCreateNoteOptions = {}
) {
  const [view, setView] = useState(() => emptySession(userId));
  const sessionRef = useRef(view);
  const mounted = useRef(false);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const session = restoreDraft(userId);
    sessionRef.current = session;
    setView({ ...session });
    return () => { mounted.current = false; };
  }, [userId]);

  const publish = useCallback((session: Session) => {
    if (mounted.current && sessionRef.current === session) setView({ ...session });
  }, []);

  const changeContent = useCallback((content: Content) => {
    const session = sessionRef.current;
    if (session.userId !== userId) return;
    if (session.text === content.text && JSON.stringify(session.json) === JSON.stringify(content.json)) return;
    Object.assign(session, content);
    session.revision += 1;
    session.draftRestored = false;
    if (session.saveState !== 'saving') session.saveState = 'idle';
    session.error = '';
    persistDraft(session);
    publish(session);
  }, [publish, userId]);

  const setNewContentText = useCallback((text: string) => {
    changeContent({ text, json: sessionRef.current.json });
  }, [changeContent]);
  const setNewContentJson = useCallback((json: JSONContent | null) => {
    changeContent({ text: sessionRef.current.text, json });
  }, [changeContent]);

  const discardDraft = useCallback(() => {
    const session = sessionRef.current;
    if (session.userId !== userId || session.saveState === 'saving') return false;
    if (!removeStoredDraft(session)) {
      session.localDraftState = 'unavailable';
      session.error = '无法清除本机草稿，请稍后重试。';
      publish(session);
      return false;
    }
    Object.assign(session, emptySession(userId), { revision: session.revision + 1 });
    publish(session);
    return true;
  }, [publish, userId]);

  // True means the submitted draft is saved and unchanged; the caller may close the editor.
  const handleSubmit = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    const contentText = session.text.trim();
    if (session.userId !== userId || !contentText || session.saveState === 'saving') return false;
    const revision = session.revision;
    const contentJson = session.json;
    session.saveState = 'saving';
    session.error = '';
    publish(session);
    onError?.('');

    try {
      const note = await createNote({
        body: contentJson
          ? { kind: 'rich-text', document: contentJson as Record<string, unknown> }
          : { kind: 'plain-text', text: contentText },
        optimistic: { contentText, contentJson: contentJson as Record<string, unknown> | null },
      });
      const unchanged = session.revision === revision;
      if (unchanged) {
        const removed = removeStoredDraft(session);
        session.text = '';
        session.json = null;
        session.storedValue = null;
        session.localDraftState = removed ? 'empty' : 'unavailable';
        session.draftRestored = false;
        if (!removed) session.error = '笔记已保存到云端，但本机草稿未能清除。再次进入时请勿重复保存。';
      }
      session.saveState = 'saved';
      session.savedNote = note;
      publish(session);
      const current = mounted.current && sessionRef.current === session;
      if (current) setIsComposing(false);
      return current && unchanged;
    } catch (error: unknown) {
      session.saveState = 'failed';
      session.error = '未保存到云端，请重试。';
      publish(session);
      if (mounted.current && sessionRef.current === session) {
        onError?.(error instanceof Error ? error.message : '创建笔记失败，请稍后重试');
      }
      return false;
    }
  }, [createNote, onError, publish, userId]);

  const visible = view.userId === userId ? view : emptySession(userId);
  return {
    newContentText: visible.text,
    newContentJson: visible.json,
    setNewContentText, setNewContentJson, changeContent, discardDraft,
    loading: visible.saveState === 'saving',
    saveState: visible.saveState,
    localDraftState: visible.localDraftState,
    draftRestored: visible.draftRestored,
    savedNote: visible.savedNote,
    saveError: visible.error,
    isComposing, setIsComposing, handleSubmit,
  };
}

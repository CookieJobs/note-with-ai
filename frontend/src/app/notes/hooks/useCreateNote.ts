import { useCallback, useEffect, useRef, useState } from 'react';
import { getSchema, type JSONContent } from '@tiptap/react';
import { createRichTextExtensions } from '../components/tiptap/richTextPreset';
import type { CreateNoteCommand, Note } from './useNotes';

type UseCreateNoteOptions = {
  userId?: string | null;
  onError?: (message: string) => void;
};

export type CaptureSaveState = 'idle' | 'saving' | 'saved' | 'failed';
export type LocalDraftState = 'empty' | 'saved' | 'unavailable';

type Content = {
  text: string;
  json: JSONContent | null;
};

type CaptureSession = Content & {
  userId: string | null;
  revision: number;
  storedValue: string | null;
  localDraftState: LocalDraftState;
  draftRestored: boolean;
  saveState: CaptureSaveState;
  saveError: string;
};

const draftKey = (userId: string) => `quick-capture-draft:${userId}`;

function createEmptySession(userId: string | null): CaptureSession {
  return {
    userId,
    text: '',
    json: null,
    revision: 0,
    storedValue: null,
    localDraftState: 'empty',
    draftRestored: false,
    saveState: 'idle',
    saveError: '',
  };
}

let draftSchema: ReturnType<typeof getSchema> | undefined;

function restoreDraft(userId: string | null): CaptureSession {
  const session = createEmptySession(userId);
  if (!userId) return session;

  try {
    const storedValue = localStorage.getItem(draftKey(userId));
    if (!storedValue) return session;

    const parsed = JSON.parse(storedValue);
    if ((parsed?.version !== undefined && parsed.version !== 1) || typeof parsed?.text !== 'string') {
      throw new Error('invalid draft');
    }

    let json = parsed.json as JSONContent | null;
    let saveError = '';
    if (json !== null) {
      try {
        if (json?.type !== 'doc') throw new Error('invalid document');
        draftSchema ??= getSchema(createRichTextExtensions());
        draftSchema.nodeFromJSON(json).check();
      } catch {
        json = null;
        saveError = '草稿格式无法恢复，已保留文字内容，请检查后保存。';
      }
    }

    return {
      ...session,
      text: parsed.text,
      json,
      storedValue,
      localDraftState: parsed.text.trim() ? 'saved' : 'empty',
      draftRestored: Boolean(parsed.text.trim()),
      saveError,
    };
  } catch {
    return { ...session, localDraftState: 'unavailable', saveError: '本机草稿无法读取，请继续编辑后重新保存。' };
  }
}

function persistDraft(session: CaptureSession) {
  if (!session.userId) return;

  try {
    const key = draftKey(session.userId);
    if (!session.text.trim()) {
      if (localStorage.getItem(key) === session.storedValue) localStorage.removeItem(key);
      session.storedValue = null;
      session.localDraftState = 'empty';
      return;
    }

    const storedValue = JSON.stringify({
      version: 1,
      text: session.text,
      json: session.json,
      updatedAt: Date.now(),
    });
    localStorage.setItem(key, storedValue);
    session.storedValue = storedValue;
    session.localDraftState = 'saved';
  } catch {
    session.localDraftState = 'unavailable';
  }
}

function removeDraft(session: CaptureSession): boolean {
  if (!session.userId) return true;

  try {
    const key = draftKey(session.userId);
    if (localStorage.getItem(key) !== session.storedValue) return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function useCreateNote(
  createNote: (command: CreateNoteCommand) => Promise<Note>,
  { userId = null, onError }: UseCreateNoteOptions = {},
) {
  const [view, setView] = useState(() => createEmptySession(userId));
  const sessionRef = useRef(view);
  const mountedRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    const restored = restoreDraft(userId);
    sessionRef.current = restored;
    setView({ ...restored });
    return () => {
      mountedRef.current = false;
    };
  }, [userId]);

  const publish = useCallback((session: CaptureSession) => {
    if (mountedRef.current && sessionRef.current === session) setView({ ...session });
  }, []);

  const changeContent = useCallback((next: Content) => {
    const session = sessionRef.current;
    if (session.userId !== userId) return;
    if (session.text === next.text && JSON.stringify(session.json) === JSON.stringify(next.json)) return;

    session.text = next.text;
    session.json = next.json;
    session.revision += 1;
    session.draftRestored = false;
    if (session.saveState !== 'saving') session.saveState = 'idle';
    session.saveError = '';
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
    if (!removeDraft(session)) {
      session.localDraftState = 'unavailable';
      session.saveError = '无法清除本机草稿，请稍后重试。';
      publish(session);
      return false;
    }

    const replacement = createEmptySession(userId);
    replacement.revision = session.revision + 1;
    sessionRef.current = replacement;
    publish(replacement);
    return true;
  }, [publish, userId]);

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    const contentText = session.text.trim();
    if (session.userId !== userId || !contentText || session.saveState === 'saving') return false;

    const submittedRevision = session.revision;
    const submittedJson = session.json;
    session.saveState = 'saving';
    session.saveError = '';
    publish(session);
    onError?.('');

    try {
      await createNote({
        body: submittedJson
          ? { kind: 'rich-text', document: submittedJson as Record<string, unknown> }
          : { kind: 'plain-text', text: contentText },
        optimistic: {
          contentText,
          contentJson: submittedJson as Record<string, unknown> | null,
        },
      });

      if (session.revision === submittedRevision) {
        const removed = removeDraft(session);
        session.text = '';
        session.json = null;
        session.storedValue = null;
        session.localDraftState = removed ? 'empty' : 'unavailable';
        session.draftRestored = false;
        if (!removed) session.saveError = '笔记已保存到云端，但本机草稿未能清除。';
      }

      session.saveState = 'saved';
      publish(session);
      if (mountedRef.current && sessionRef.current === session && session.revision === submittedRevision) {
        setIsComposing(false);
        return true;
      }
      return false;
    } catch (error: unknown) {
      session.saveState = 'failed';
      session.saveError = '未保存到云端，请重试。';
      publish(session);
      if (mountedRef.current && sessionRef.current === session) {
        onError?.(error instanceof Error ? error.message : '创建笔记失败，请稍后重试');
      }
      return false;
    }
  }, [createNote, onError, publish, userId]);

  const visible = view.userId === userId ? view : createEmptySession(userId);
  return {
    newContentText: visible.text,
    newContentJson: visible.json,
    setNewContentText,
    setNewContentJson,
    changeContent,
    discardDraft,
    loading: visible.saveState === 'saving',
    saveState: visible.saveState,
    localDraftState: visible.localDraftState,
    draftRestored: visible.draftRestored,
    saveError: visible.saveError,
    isComposing,
    setIsComposing,
    handleSubmit,
  };
}

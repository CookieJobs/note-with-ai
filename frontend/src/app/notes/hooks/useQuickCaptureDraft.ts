'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type QuickCaptureContext = {
  origin: 'relationship';
  relationshipId: string;
  sourceNoteIds: [string, string];
};

export type QuickCaptureDraft = {
  text: string;
  title?: string;
  editorMode: 'plain' | 'rich';
  updatedAt: string;
  context?: QuickCaptureContext;
};

type DraftInput = Omit<QuickCaptureDraft, 'updatedAt'>;

function keyFor(userId: string | null | undefined) {
  return userId ? `quick-capture-draft:${userId}` : null;
}

function readDraft(key: string | null): QuickCaptureDraft | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuickCaptureDraft>;
    if (typeof parsed.text !== 'string' || (parsed.editorMode !== 'plain' && parsed.editorMode !== 'rich')) return null;
    return { text: parsed.text, title: typeof parsed.title === 'string' ? parsed.title : undefined, editorMode: parsed.editorMode, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(), context: parsed.context };
  } catch {
    return null;
  }
}

export function useQuickCaptureDraft(userId: string | null | undefined) {
  const storageKey = keyFor(userId);
  const [draft, setDraft] = useState<QuickCaptureDraft | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<QuickCaptureDraft | null>(null);

  const restoreDraft = useCallback(() => {
    const restored = readDraft(storageKey);
    latestDraftRef.current = restored;
    setDraft(restored);
    return restored;
  }, [storageKey]);

  const flushDraft = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!storageKey || typeof window === 'undefined' || !latestDraftRef.current) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(latestDraftRef.current));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [storageKey]);

  useEffect(() => {
    restoreDraft();
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flushDraft);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, [flushDraft, restoreDraft]);

  const saveDraft = useCallback((input: DraftInput) => {
    const next: QuickCaptureDraft = { ...input, updatedAt: new Date().toISOString() };
    latestDraftRef.current = next;
    setDraft(next);
    if (!storageKey || typeof window === 'undefined') return next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        timerRef.current = null;
        setStorageAvailable(true);
      } catch {
        setStorageAvailable(false);
      }
    }, 300);
    return next;
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    latestDraftRef.current = null;
    setDraft(null);
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      setStorageAvailable(false);
    }
  }, [storageKey]);

  return { draft, saveDraft, clearDraft, restoreDraft, storageAvailable };
}

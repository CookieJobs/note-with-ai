import { useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '../../../utils/auth';
import { generateUUID } from '../../../utils/uuid';
import type { INote, IUserProfile } from '../../../types';
import { buildRecommendCacheFromResponse } from '../utils/recommendCache';

export type Note = INote;

export type NoteBodyInput =
  | { kind: 'rich-text'; document: Record<string, unknown>; fallbackMarkdown?: string }
  | { kind: 'plain-text'; text: string };

export type UpdateNoteCommand = {
  noteId: string;
  expectedRevision: number;
  changes: {
    body?: NoteBodyInput;
    title?: string;
    keywords?: string[];
  };
};

export type CreateNoteCommand = {
  body: NoteBodyInput;
  optimistic: {
    contentText: string;
    contentJson?: Record<string, unknown> | null;
  };
};

export class NoteWriteConflict extends Error {
  readonly code = 'NOTE_WRITE_CONFLICT' as const;

  constructor(public readonly current: Note) {
    super('笔记已被其他写入更新');
    this.name = 'NoteWriteConflict';
  }
}

const NOTES_QUERY_KEY = ['notes'] as const;
const ENRICHMENT_STATUSES = new Set(['pending', 'ready', 'degraded']);
const ENRICHMENT_POLL_DELAY_MS = 5_000;
const ENRICHMENT_POLL_MAX_ATTEMPTS = 5;
const ENRICHMENT_POLL_MAX_AGE_MS = 60_000;

type PendingObservation = {
  attempts: number;
  observedAt: number;
  nextEligibleAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCanonicalNoteWrite(payload: unknown, requireSuccess = false): Note {
  if (requireSuccess && (!isRecord(payload) || payload.success !== true)) {
    throw new Error('笔记写入响应无效');
  }
  const envelope = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(envelope) || !isRecord(envelope.note) || !isRecord(envelope.enrichment)) {
    throw new Error('笔记写入响应无效');
  }

  const { note, enrichment } = envelope;
  if (
    typeof note._id !== 'string' ||
    note._id.trim().length === 0 ||
    !Number.isInteger(note.revision) ||
    Number(note.revision) <= 0 ||
    !Number.isInteger(enrichment.sourceRevision) ||
    Number(enrichment.sourceRevision) <= 0 ||
    Number(enrichment.sourceRevision) !== Number(note.revision) ||
    typeof enrichment.status !== 'string' ||
    !ENRICHMENT_STATUSES.has(enrichment.status)
  ) {
    throw new Error('笔记写入响应无效');
  }

  return {
    ...note,
    enrichment: {
      sourceRevision: enrichment.sourceRevision,
      status: enrichment.status,
    },
  } as Note;
}

function replaceCachedNote(notes: Note[] | undefined, canonical: Note): Note[] {
  return (notes ?? []).map((note) => note._id === canonical._id ? canonical : note);
}

function enrichmentProgress(note: Note): number {
  switch (note.enrichment?.status) {
    case 'ready': return 2;
    case 'degraded': return 1;
    default: return 0;
  }
}

function selectCanonicalSnapshot(cached: Note | undefined, incoming: Note): Note {
  if (!cached || cached._id !== incoming._id) return incoming;
  if (cached.revision > incoming.revision) return cached;
  if (cached.revision < incoming.revision) return incoming;

  // Older list DTOs can omit enrichment. A validated canonical response is the
  // narrow compatibility case where an equal revision may still fill it in.
  if (!cached.enrichment && incoming.enrichment) return incoming;

  // A matching revision has immutable primary content. Keep the complete snapshot
  // that has observed strictly more enrichment progress rather than mixing fields.
  return enrichmentProgress(incoming) > enrichmentProgress(cached) ? incoming : cached;
}

function replaceTemporaryNote(notes: Note[] | undefined, temporaryId: string, canonical: Note): Note[] {
  const current = notes ?? [];
  const withoutReplacement = current.filter((note) => note._id !== temporaryId && note._id !== canonical._id);
  return [canonical, ...withoutReplacement];
}

type UseNotesOptions = {
  onError?: (message: string) => void;
};

export function useNotes(user: IUserProfile | null, options: UseNotesOptions = {}) {
  const { onError } = options;
  const queryClient = useQueryClient();
  const pendingRef = useRef(new Map<string, PendingObservation>());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const listGenerationRef = useRef(0);
  const temporaryNoteIdsRef = useRef(new Set<string>());

  const mergeFetchedNotesWithTemporaryNotes = useCallback((fetched: Note[]): Note[] => {
    const cached = queryClient.getQueryData<Note[]>(NOTES_QUERY_KEY) ?? [];
    const temporaryNotes = cached.filter((note) => temporaryNoteIdsRef.current.has(note._id));
    const fetchedWithoutTemporaryNotes = fetched.filter((note) => !temporaryNoteIdsRef.current.has(note._id));
    return [...temporaryNotes, ...fetchedWithoutTemporaryNotes];
  }, [queryClient]);

  const commitNotesWrite = useCallback((updater: (cached: Note[] | undefined) => Note[]) => {
    // A GET begun before this write may still resolve even when the browser ignores abort.
    // Its captured generation makes it return this canonical cache instead of stale list data.
    listGenerationRef.current += 1;
    queryClient.setQueryData<Note[]>(NOTES_QUERY_KEY, updater);
    void queryClient.cancelQueries({ queryKey: NOTES_QUERY_KEY, exact: true });
  }, [queryClient]);

  const commitCanonicalNote = useCallback((incoming: Note): Note => {
    let selected = incoming;
    commitNotesWrite((cached) => {
      selected = selectCanonicalSnapshot(cached?.find((note) => note._id === incoming._id), incoming);
      return replaceCachedNote(cached, selected);
    });
    return selected;
  }, [commitNotesWrite]);

  const { data: notes = [], isLoading, error, refetch } = useQuery({
    queryKey: NOTES_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const requestGeneration = listGenerationRef.current;
      const res = await authFetch('/api/notes', { signal });
      if (!res.ok) throw new Error(`请求失败: ${res.status}`);
      const response = await res.json();

      if (response.success && response.data && Array.isArray(response.data.notes)) {
        if (requestGeneration !== listGenerationRef.current) {
          return mergeFetchedNotesWithTemporaryNotes(queryClient.getQueryData<Note[]>(NOTES_QUERY_KEY) ?? []);
        }
        return mergeFetchedNotesWithTemporaryNotes(response.data.notes as Note[]);
      }
      console.warn('⚠️ /api/notes 返回格式错误:', response);
      return [];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (error) {
      console.error('加载失败:', error);
      onError?.('加载失败，请稍后重试');
    }
  }, [error, onError]);

  const observationKeyFor = useCallback((note: Note) => (
    `${note._id}:${note.enrichment?.sourceRevision ?? note.revision}`
  ), []);

  const reconcilePendingNotes = useCallback((nextNotes: Note[]) => {
    const activeKeys = new Set<string>();
    const observedAt = Date.now();

    for (const note of nextNotes) {
      if (note.revision <= 0 || note.enrichment?.status !== 'pending') continue;
      const key = observationKeyFor(note);
      activeKeys.add(key);
      if (!pendingRef.current.has(key)) {
        pendingRef.current.set(key, {
          attempts: 0,
          observedAt,
          nextEligibleAt: observedAt + ENRICHMENT_POLL_DELAY_MS,
        });
      }
    }

    for (const key of pendingRef.current.keys()) {
      if (!activeKeys.has(key)) pendingRef.current.delete(key);
    }
  }, [observationKeyFor]);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const isPollingAllowed = useCallback(() => (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  ), []);

  const schedulePoll = useCallback(() => {
    if (!isMountedRef.current || pollTimerRef.current || pendingRef.current.size === 0 || !isPollingAllowed()) return;

    const now = Date.now();
    let earliestEligibleAt = Number.POSITIVE_INFINITY;
    for (const [key, observation] of pendingRef.current) {
      if (observation.attempts >= ENRICHMENT_POLL_MAX_ATTEMPTS || now - observation.observedAt >= ENRICHMENT_POLL_MAX_AGE_MS) {
        pendingRef.current.delete(key);
        continue;
      }
      earliestEligibleAt = Math.min(earliestEligibleAt, observation.nextEligibleAt);
    }
    if (!Number.isFinite(earliestEligibleAt)) return;

    pollTimerRef.current = setTimeout(async () => {
      pollTimerRef.current = null;
      if (!isMountedRef.current || !isPollingAllowed()) return;

      const now = Date.now();
      let hasEligibleObservation = false;
      for (const [key, observation] of pendingRef.current) {
        if (
          observation.attempts >= ENRICHMENT_POLL_MAX_ATTEMPTS ||
          now - observation.observedAt >= ENRICHMENT_POLL_MAX_AGE_MS
        ) {
          pendingRef.current.delete(key);
          continue;
        }
        if (now < observation.nextEligibleAt) continue;
        observation.attempts += 1;
        observation.nextEligibleAt = now + ENRICHMENT_POLL_DELAY_MS;
        hasEligibleObservation = true;
      }
      if (!hasEligibleObservation) return;

      try {
        const result = await refetch();
        if (Array.isArray(result.data)) reconcilePendingNotes(result.data);
      } finally {
        if (isMountedRef.current) schedulePoll();
      }
    }, Math.max(0, earliestEligibleAt - now));
  }, [isPollingAllowed, reconcilePendingNotes, refetch]);

  useEffect(() => {
    isMountedRef.current = true;
    const pendingObservations = pendingRef.current;
    return () => {
      isMountedRef.current = false;
      pendingObservations.clear();
      clearPollTimer();
    };
  }, [clearPollTimer]);

  useEffect(() => {
    reconcilePendingNotes(notes);
    schedulePoll();
  }, [notes, reconcilePendingNotes, schedulePoll]);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (isPollingAllowed()) {
        schedulePoll();
      } else {
        clearPollTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('blur', handleVisibilityOrFocus);
    return () => {
      clearPollTimer();
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('blur', handleVisibilityOrFocus);
    };
  }, [clearPollTimer, isPollingAllowed, schedulePoll]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      return id;
    },
    onSuccess: (deletedId) => {
      commitNotesWrite((old) => {
        if (!old) return [];
        return old.filter((n) => n._id !== deletedId);
      });
    },
    onError: (err) => {
      console.error('删除失败:', err);
      onError?.('删除失败，请稍后重试');
    }
  });

  const updateNote = useCallback(async (command: UpdateNoteCommand): Promise<Note> => {
    const response = await authFetch(`/api/notes/${command.noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: command.expectedRevision,
        changes: command.changes,
      }),
    });
    const payload: unknown = await response.json().catch(() => undefined);

    if (response.ok) {
      const canonical = readCanonicalNoteWrite(payload, true);
      if (canonical._id !== command.noteId) throw new Error('笔记写入响应无效');
      return commitCanonicalNote(canonical);
    }

    if (response.status === 409 && isRecord(payload) && payload.code === 'NOTE_WRITE_CONFLICT') {
      const current = readCanonicalNoteWrite(payload.current);
      if (current._id !== command.noteId) throw new Error('笔记写入响应无效');
      throw new NoteWriteConflict(commitCanonicalNote(current));
    }

    if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) {
      throw new Error(payload.message);
    }
    throw new Error('保存笔记失败，请重试');
  }, [commitCanonicalNote]);

  const createNote = useCallback(async (command: CreateNoteCommand): Promise<Note> => {
    const now = new Date().toISOString();
    const temporaryId = `temp-${generateUUID()}`;
    const temporary: Note = {
      _id: temporaryId,
      title: '',
      content: command.optimistic.contentText,
      contentText: command.optimistic.contentText,
      contentJson: command.optimistic.contentJson ?? undefined,
      summary: '',
      concepts: [],
      keywords: [],
      recommendCache: null,
      revision: 0,
      enrichment: { sourceRevision: 0, status: 'pending' },
      createdAt: now,
      updatedAt: now,
    };
    temporaryNoteIdsRef.current.add(temporaryId);
    commitNotesWrite((notes = []) => [temporary, ...notes]);

    try {
      const response = await authFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: command.body }),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) {
          throw new Error(payload.message);
        }
        throw new Error('创建笔记失败，请重试');
      }

      const canonical = readCanonicalNoteWrite(payload, true);
      let selected = canonical;
      temporaryNoteIdsRef.current.delete(temporaryId);
      commitNotesWrite((notes) => {
        selected = selectCanonicalSnapshot(notes?.find((note) => note._id === canonical._id), canonical);
        return replaceTemporaryNote(notes, temporaryId, selected);
      });
      return selected;
    } catch (error) {
      temporaryNoteIdsRef.current.delete(temporaryId);
      commitNotesWrite((notes = []) => notes.filter((note) => note._id !== temporaryId));
      throw error;
    }
  }, [commitNotesWrite]);

  const refreshRecommendCache = useCallback(async (noteId: string): Promise<void> => {
    const source = queryClient.getQueryData<Note[]>(NOTES_QUERY_KEY)?.find((note) => note._id === noteId);
    if (!source) throw new Error('笔记不存在，无法刷新相关推荐');

    const response = await authFetch('/api/recommend/semantic-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId, writeMode: 'await' }),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) {
        throw new Error(payload.message);
      }
      throw new Error('刷新相关推荐失败');
    }
    if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data) || !Array.isArray(payload.data.recommendations)) {
      throw new Error('推荐响应无效');
    }

    const recommendCache = buildRecommendCacheFromResponse({
      updatedAt: source.updatedAt,
      revision: source.revision,
    }, payload);
    commitNotesWrite((notes = []) => notes.map((note) => (
      note._id === noteId && note.revision === source.revision
        ? { ...note, recommendCache }
        : note
    )));
  }, [commitNotesWrite, queryClient]);

  return {
    notes,
    isLoading,
    deleteNote: deleteMutation.mutateAsync,
    createNote,
    updateNote,
    refreshRecommendCache,
    refetchNotes: refetch,
  };
}

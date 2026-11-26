/* Independent search cache; note writes stay in useNotes. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../../../utils/auth';
import type { Note } from './useNotes';

type SearchState = { notes: Note[]; cursor: string | null; pageCount: number; version: number; isLoading: boolean; isLoadingMore: boolean; error: string | null; loadMoreError: string | null };
const empty = (): SearchState => ({ notes: [], cursor: null, pageCount: 0, version: -1, isLoading: false, isLoadingMore: false, error: null, loadMoreError: null });

export function useNoteSearch(userId: string | null, query: string, version: number) {
  const cache = useRef(new Map<string, SearchState>());
  const owner = useRef(userId);
  if (owner.current !== userId) { owner.current = userId; cache.current.clear(); }
  const key = JSON.stringify([userId, query, version]);
  const current = useRef(key); current.current = key;
  const request = useRef<{ controller: AbortController; frostUpdates: Map<string, number> } | null>(null);
  const [, redraw] = useState(0);
  const publish = useCallback((value: SearchState) => { cache.current.set(query, value); redraw(n => n + 1); }, [query]);
  const applyFrostLayers = useCallback((noteId: string, layers: number) => {
    request.current?.frostUpdates.set(noteId, layers);
    let changed = false;
    for (const [keyword, state] of cache.current) {
      if (!state.notes.some(note => note._id === noteId && note.frostLayers !== layers)) continue;
      cache.current.set(keyword, {
        ...state,
        notes: state.notes.map(note => note._id === noteId ? { ...note, frostLayers: layers } : note),
      });
      changed = true;
    }
    if (changed) redraw(n => n + 1);
  }, []);
  const fetchPages = useCallback(async (append = false) => {
    if (!userId || !query) return;
    const previous = cache.current.get(query) ?? empty();
    if (append && (!previous.cursor || previous.isLoadingMore || previous.isLoading || previous.version !== version)) return;
    request.current?.controller.abort();
    const controller = new AbortController();
    const frostUpdates = new Map<string, number>();
    const activeRequest = { controller, frostUpdates };
    request.current = activeRequest;
    const valid = () => !controller.signal.aborted && current.current === key;
    const initial = { ...previous, version, error: null, loadMoreError: null, isLoading: !append, isLoadingMore: append };
    publish(initial);
    let notes = append ? [...previous.notes] : [] as Note[];
    let cursor = append ? previous.cursor : null;
    let pageCount = append ? previous.pageCount : 0;
    const target = append ? 1 : Math.max(1, previous.pageCount);
    try {
      for (let page = 0; page < target; page++) {
        const response = await authFetch(`/api/notes?q=${encodeURIComponent(query)}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload?.success || !Array.isArray(payload.data?.notes) || !payload.data?.pageInfo) throw Error('搜索笔记失败，请重试');
        if (!valid()) return;
        const known = new Set(notes.map(note => note._id));
        notes = [...notes, ...(payload.data.notes as Note[]).filter(note => !known.has(note._id))];
        cursor = payload.data.pageInfo.hasMore && typeof payload.data.pageInfo.nextCursor === 'string' ? payload.data.pageInfo.nextCursor : null;
        pageCount++;
        if (!cursor) break;
      }
      if (valid()) {
        const confirmedNotes = notes.map(note => {
          const layers = frostUpdates.get(note._id);
          return layers === undefined ? note : { ...note, frostLayers: layers };
        });
        publish({ ...initial, notes: confirmedNotes, cursor, pageCount, isLoading: false, isLoadingMore: false });
      }
    } catch {
      if (valid()) publish({ ...initial, notes: append ? cache.current.get(query)?.notes ?? [] : [], isLoading: false, isLoadingMore: false,
        error: append ? null : '搜索笔记失败，请重试', loadMoreError: append ? '加载更多搜索结果失败' : null });
    } finally {
      if (request.current === activeRequest) request.current = null;
    }
  }, [userId, query, version, key, publish]);
  useEffect(() => {
    if (userId && query) {
      const saved = cache.current.get(query);
      if (!saved || saved.version !== version || saved.isLoading || saved.isLoadingMore) void fetchPages();
    }
    return () => { request.current?.controller.abort(); };
  }, [userId, query, version, fetchPages]);
  const saved = userId && query ? cache.current.get(query) : undefined;
  const state = saved?.version === version ? saved : { ...empty(), isLoading: !!(userId && query) };
  return { ...state, applyFrostLayers, hasMore: !!state.cursor, loadMore: () => fetchPages(true), retry: () => fetchPages(false) };
}

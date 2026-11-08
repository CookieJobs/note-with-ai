/* List-local read-only month cache, isolated by account and successful-write version. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../../../utils/auth';
export type NoteCalendarData = { month: string; timezone: string; noteCount: number; recordedDayCount: number; days: { date: string; count: number }[] };
type Entry = { data: NoteCalendarData | null; loading: boolean; error: string | null; version: number };
export function useNoteCalendar(userId: string | null, month: string, version: number) {
  const cache = useRef(new Map<string, Entry>());
  const owner = useRef(userId);
  if (owner.current !== userId) { owner.current = userId; cache.current.clear(); }
  const key = JSON.stringify([userId, month, version]);
  const current = useRef(key); current.current = key;
  const request = useRef<AbortController | null>(null);
  const [, redraw] = useState(0);
  const fetchMonth = useCallback(async () => {
    if (!userId) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const valid = () => !controller.signal.aborted && current.current === key;
    const publish = (entry: Entry) => { cache.current.set(month, entry); redraw(n => n + 1); };
    publish({ data: null, loading: true, error: null, version });
    try {
      const response = await authFetch(`/api/notes/calendar?month=${encodeURIComponent(month)}`, { signal: controller.signal });
      const payload = await response.json();
      const data = payload?.data;
      if (!response.ok || !payload?.success || data?.month !== month || data.timezone !== 'Asia/Shanghai' || !Array.isArray(data.days)
        || !Number.isInteger(data.noteCount) || !Number.isInteger(data.recordedDayCount)) throw Error('invalid calendar response');
      if (valid()) publish({ data, loading: false, error: null, version });
    } catch {
      if (valid()) publish({ data: null, loading: false, error: '月历统计加载失败', version });
    }
  }, [userId, month, version, key]);
  useEffect(() => {
    const saved = cache.current.get(month);
    if (userId && (!saved || saved.version !== version || saved.loading)) void fetchMonth();
    return () => request.current?.abort();
  }, [userId, month, version, fetchMonth]);
  const saved = userId ? cache.current.get(month) : undefined;
  const state = saved?.version === version ? saved : { data: null, loading: !!userId, error: null };
  return { ...state, retry: fetchMonth };
}

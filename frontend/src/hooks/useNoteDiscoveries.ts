'use client';
// Owner-fenced discovery reads. Polling only reads, never creates generation work.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DiscoveryList, noteDiscoveries } from '../services/noteDiscoveries';
export const DISCOVERY_POLL_MS = 4000;
export const DISCOVERY_POLL_LIMIT = 30;
export function useNoteDiscoveries(userId: string) {
  const [state, setState] = useState<{ owner: string; data?: DiscoveryList; error: string; loading: boolean; paused?: boolean }>({ owner: userId, error: '', loading: true });
  const owner = useRef(userId);
  owner.current = userId;
  const revision = useRef(0);
  const visit = useRef({ owner: userId, admitted: false });
  if (visit.current.owner !== userId) visit.current = { owner: userId, admitted: false };
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey(key => key + 1), []);
  const update = (updater: (data: DiscoveryList) => DiscoveryList) => { revision.current++; setState(prev => prev.owner === userId && prev.data ? { ...prev, data: updater(prev.data) } : prev); };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let polls = 0;
    const current = () => !disposed && owner.current === userId;
    const load = async () => {
      if (!current() || document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      const requestController = controller;
      const readRevision = revision.current;
      const admit = !visit.current.admitted;
      visit.current.admitted = true;
      try {
        const data = await noteDiscoveries.list(requestController.signal, false, admit);
        if (!current() || requestController.signal.aborted || controller !== requestController || readRevision !== revision.current) return;
        const pending = ['queued', 'running'].includes(data.run.status);
        const paused = pending && polls >= DISCOVERY_POLL_LIMIT;
        setState({ owner: userId, data, error: '', loading: false, paused });
        if (pending && !paused) { polls++; timer = setTimeout(load, DISCOVERY_POLL_MS); }
      } catch (error) {
        if (!current() || requestController.signal.aborted || controller !== requestController || readRevision !== revision.current) return;
        setState(prev => ({ ...prev, owner: userId, error: '发现暂时加载失败，请重试。', loading: false }));
      }
    };
    const visibility = () => {
      if (timer) clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else void load();
    };
    setState(prev => prev.owner === userId ? { ...prev, error: '', paused: false } : { owner: userId, error: '', loading: true });
    document.addEventListener('visibilitychange', visibility);
    void load();
    return () => { disposed = true; controller?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [userId, refreshKey]);
  return { ...(state.owner === userId ? state : { loading: true, error: '', data: undefined, paused: false }), reload, update };
}

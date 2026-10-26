/*
Input: 当前账户/路由、笔记页成功查询登记和现有笔记读取接口
Output: 独立的最近五条阅读链接及加载/失败/空状态
Pos: frontend/src/components/workspace；修改时同步本目录 README。
*/
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../../utils/auth';
import { noteReferenceDisplay, type NoteReferenceInput } from '../../utils/noteReference';
import type { WorkspaceRecentNote } from './WorkspaceContext';

type Snapshot = { userId: string | null; status: 'idle' | 'loading' | 'ready' | 'error'; notes: WorkspaceRecentNote[] };

export function useWorkspaceRecentNotes(userId: string | null, pathname: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ userId: null, status: 'idle', notes: [] });
  const [attempt, setAttempt] = useState(0);
  const ownerRef = useRef({ userId, pathname });
  const projectionUser = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  if (ownerRef.current.userId !== userId || ownerRef.current.pathname !== pathname) {
    if (ownerRef.current.userId !== userId) projectionUser.current = null;
    ownerRef.current = { userId, pathname };
  }

  const setRecentNotes = useCallback((notes: WorkspaceRecentNote[]) => {
    if (!userId || ownerRef.current.userId !== userId) return;
    // Only confirmed successful page lists are registered, including a confirmed empty library.
    // Such a registration outranks an in-flight fallback.
    requestRef.current?.abort(); requestRef.current = null;
    projectionUser.current = userId;
    const recent = notes.slice(0, 5);
    setSnapshot(previous => previous.userId === userId && previous.status === 'ready' && JSON.stringify(previous.notes) === JSON.stringify(recent)
      ? previous : { userId, status: 'ready', notes: recent });
  }, [userId]);

  useEffect(() => {
    if (!userId || pathname.startsWith('/notes') || projectionUser.current === userId) return;
    const owner = ownerRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && ownerRef.current === owner && requestRef.current === controller;
    setSnapshot({ userId, status: 'loading', notes: [] });
    void (async () => {
      try {
        const response = await authFetch('/api/notes', { signal: controller.signal });
        if (!response.ok) throw new Error('读取最近笔记失败');
        const payload = await response.json();
        if (!payload?.success || !Array.isArray(payload.data?.notes)) throw new Error('最近笔记响应无效');
        const notes = (payload.data.notes as (NoteReferenceInput & { _id: string })[]).slice(0, 5).map(note => {
          if (!note || typeof note._id !== 'string' || !note._id) throw new Error('最近笔记响应无效');
          return { id: note._id, title: noteReferenceDisplay(note).label, href: '/notes?highlight=' + encodeURIComponent(note._id) };
        });
        if (!isCurrent()) return;
        projectionUser.current = userId;
        setSnapshot({ userId, status: 'ready', notes });
      } catch {
        if (isCurrent()) setSnapshot({ userId, status: 'error', notes: [] });
      }
    })();
    return () => {
      controller.abort();
      if (requestRef.current === controller) requestRef.current = null;
    };
  }, [userId, pathname, attempt]);

  const current = snapshot.userId === userId ? snapshot : null;
  return {
    recentNotes: current?.notes ?? [],
    status: current?.status ?? (userId ? 'loading' : 'idle'),
    setRecentNotes,
    retry: () => setAttempt(value => value + 1),
  };
}

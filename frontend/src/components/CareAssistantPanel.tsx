'use client';

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../utils/auth';
import styles from '../app/chat/chat.module.scss';

interface CareIntro {
  noteId: string | null;
  noteTitle: string;
  snippet: string;
  aiOpening: string;
}

interface Props {
  onInsert: (text: string) => void;
  onSend: (text: string) => void;
  auto?: boolean;
}

export default function CareAssistantPanel({ onInsert, onSend, auto = false }: Props) {
  const [intro, setIntro] = useState<CareIntro | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const fetchIntro = async () => {
    setLoading(true);
    setError('');
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await authFetch('/api/chat/robot/intro', { signal: abortRef.current.signal } as any);
      const json = await res.json();
      const payload = json && json.data ? json.data : json;
      const data: CareIntro = {
        noteId: payload?.noteId ?? null,
        noteTitle: payload?.noteTitle || '',
        snippet: payload?.snippet || '',
        aiOpening: payload?.aiOpening || ''
      };
      setIntro(data);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError('获取失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return () => abortRef.current?.abort();
    if (!auto) return () => abortRef.current?.abort();
    fetchedRef.current = true;
    fetchIntro();
    return () => abortRef.current?.abort();
  }, [auto]);

  return (
    <div className={styles.carePanel}>
      <div className={styles.careHeader} style={{ justifyContent: 'center' }}>
        <div className={styles.careIcon} aria-hidden="true">🌿</div>
        <div className={styles.careTitles} style={{ alignItems: 'center' }}>
          <div className={styles.careTitle}>随机漫步</div>
          <div className={styles.careSubTitle}>给你一个贴心话题</div>
        </div>
        <button className={styles.robotButtonPrimary} aria-label="触发" onClick={fetchIntro}>触发</button>
        <button className={styles.robotButtonSecondary} aria-label="换一个" onClick={fetchIntro}>换一个</button>
      </div>
      {loading && <div className={styles.careLoading}>正在准备贴心开场…</div>}
      {!loading && error && (
        <div className={styles.careError}>
          <span>❌ {error}</span>
          <button className={styles.robotButtonSecondary} onClick={fetchIntro}>重试</button>
        </div>
      )}
      {!loading && !error && intro && (
        <div className={styles.careContent}>
          {intro.noteTitle && <div className={styles.robotNoteTitle}>来源笔记：{intro.noteTitle}</div>}
          {intro.snippet && <div className={styles.robotSnippet}>“{intro.snippet}”</div>}
          <div className={styles.robotOpening}>{intro.aiOpening}</div>
          <div className={styles.aiRobotActions}>
            <button className={styles.robotButtonSecondary} onClick={() => onInsert(intro.aiOpening)}>插入到输入框</button>
            <button className={styles.robotButtonPrimary} onClick={() => onSend(intro.aiOpening)}>直接发送</button>
          </div>
        </div>
      )}
    </div>
  );
}

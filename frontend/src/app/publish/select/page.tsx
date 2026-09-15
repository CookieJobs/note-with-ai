'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TopNavigation from '../../../components/TopNavigation';
import { authFetch } from '../../../utils/auth';
import styles from '../publish.module.scss';

export default function SelectNoteToPublishPage() {
  const [notes, setNotes] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const loadNotes = async (cursor?: string) => {
    setIsLoading(true);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await authFetch(`/api/notes${query}`);
      const payload = await response.json();
      if (!response.ok || !payload.success || !Array.isArray(payload.data?.notes)) throw new Error('notes unavailable');
      setNotes((current) => cursor ? [...current, ...payload.data.notes] : payload.data.notes);
      setHasNextPage(payload.data.pageInfo?.hasNextPage === true);
      setNextCursor(typeof payload.data.pageInfo?.nextCursor === 'string' ? payload.data.pageInfo.nextCursor : null);
      setError('');
    } catch {
      setError('暂时无法读取笔记。');
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    void loadNotes();
  }, []);
  return <main className={styles.page}><TopNavigation /><section className={styles.content}>
    <h1>选择一篇笔记公开</h1><p>仅会创建这篇笔记当前内容的独立、可撤销快照。</p>
    {error && <p role="alert">{error}</p>}
    {notes.map((note) => <article className={styles.card} key={note._id || note.id}>
      <h2>{note.title || '未命名笔记'}</h2><p>{String(note.contentText || note.content || '').slice(0, 180)}</p>
      <Link className={styles.primary} href={'/publish/' + (note._id || note.id)}>预览并公开</Link>
    </article>)}
    {!error && !isLoading && notes.length === 0 && <p className={styles.empty}>还没有可公开的笔记。</p>}
    {hasNextPage && <button className={styles.primary} type="button" disabled={isLoading || !nextCursor} onClick={() => { if (nextCursor) void loadNotes(nextCursor); }}>
      {isLoading ? '正在加载…' : '加载更多笔记'}
    </button>}
  </section></main>;
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TopNavigation from '../../../components/TopNavigation';
import { authFetch } from '../../../utils/auth';
import styles from '../publish.module.scss';

export default function SelectNoteToPublishPage() {
  const [notes, setNotes] = useState<any[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void authFetch('/api/notes').then((response) => response.json()).then((payload) => setNotes(payload.data?.notes || [])).catch(() => setError('暂时无法读取笔记。'));
  }, []);
  return <main className={styles.page}><TopNavigation /><section className={styles.content}>
    <h1>选择一篇笔记公开</h1><p>仅会创建这篇笔记当前内容的独立、可撤销快照。</p>
    {error && <p role="alert">{error}</p>}
    {notes.map((note) => <article className={styles.card} key={note._id || note.id}>
      <h2>{note.title || '未命名笔记'}</h2><p>{String(note.contentText || note.content || '').slice(0, 180)}</p>
      <Link className={styles.primary} href={'/publish/' + (note._id || note.id)}>预览并公开</Link>
    </article>)}
    {!error && notes.length === 0 && <p className={styles.empty}>还没有可公开的笔记。</p>}
  </section></main>;
}

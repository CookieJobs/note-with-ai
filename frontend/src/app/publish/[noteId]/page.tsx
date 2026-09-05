'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TopNavigation from '../../../components/TopNavigation';
import { createPublication } from '../../../services/publicationService';
import { authFetch } from '../../../utils/auth';
import styles from '../publish.module.scss';

export default function PublishNotePage() {
  const params = useParams<{ noteId: string }>();
  const router = useRouter();
  const [note, setNote] = useState<any | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void authFetch('/api/notes').then((response) => response.json()).then((payload) => {
      const found = (payload.data?.notes || []).find((item: any) => String(item._id || item.id) === params.noteId);
      if (!found) setError('笔记不存在或无权限。'); else setNote(found);
    }).catch(() => setError('暂时无法读取笔记。'));
  }, [params.noteId]);
  const publish = async () => {
    try {
      const publication = await createPublication(params.noteId);
      router.push('/publish');
      window.navigator.clipboard?.writeText(window.location.origin + '/p/' + publication.slug);
    } catch { setError('无法创建公开链接，请稍后重试。'); }
  };
  return <main className={styles.page}><TopNavigation /><section className={styles.content}>
    <h1>公开这一篇</h1><p>不会公开其他笔记、AI 记忆、关系或聊天记录。</p>
    {error && <p role="alert">{error}</p>}
    {note && <article className={styles.preview}><h2>{note.title || '未命名笔记'}</h2><p>{note.contentText || note.content}</p><button onClick={() => { void publish(); }}>确认创建公开链接</button></article>}
  </section></main>;
}


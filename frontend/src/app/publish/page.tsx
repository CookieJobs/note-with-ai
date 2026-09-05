'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TopNavigation from '../../components/TopNavigation';
import { listPublications, refreshPublication, revokePublication, type Publication } from '../../services/publicationService';
import styles from './publish.module.scss';

export default function PublishManagerPage() {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [error, setError] = useState('');
  const load = () => { void listPublications().then(setPublications).catch(() => setError('暂时无法读取公开内容。')); };
  useEffect(load, []);
  return <main className={styles.page}><TopNavigation /><section className={styles.content}>
    <h1>公开内容</h1><p>每一篇公开内容都是独立快照；编辑私密原文不会自动更新它。</p>
    <Link className={styles.primary} href="/publish/select">选择一篇笔记公开</Link>
    {error && <p role="alert">{error}</p>}
    {publications.length === 0 && !error && <p className={styles.empty}>还没有公开的内容。</p>}
    {publications.map((publication) => <article className={styles.card} key={publication.id}>
      <h2>{publication.title || '未命名笔记'}</h2><p>{publication.status === 'active' ? '链接有效' : '链接已撤销'}</p>
      {publication.status === 'active' && <><a href={'/p/' + publication.slug} target="_blank" rel="noreferrer">打开公开页</a>
        <button onClick={() => { void refreshPublication(publication.id).then(load); }}>更新公开版本</button>
        <button onClick={() => { void revokePublication(publication.id).then(load); }}>撤销链接</button></>}
    </article>)}
  </section></main>;
}

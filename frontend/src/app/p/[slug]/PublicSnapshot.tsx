'use client';

import { useEffect, useState, type ReactNode } from 'react';
import styles from './publicNote.module.scss';

type Node = { type: string; text?: string; attrs?: Record<string, any>; marks?: Array<{ type: string; attrs?: { href: string } }>; content?: Node[] };

function renderNode(node: Node, key: string): ReactNode {
  if (node.type === 'text') {
    let value: ReactNode = node.text || '';
    for (const mark of node.marks || []) {
      if (mark.type === 'bold') value = <strong key={key}>{value}</strong>;
      if (mark.type === 'italic') value = <em key={key}>{value}</em>;
      if (mark.type === 'code') value = <code key={key}>{value}</code>;
      if (mark.type === 'link' && mark.attrs?.href) value = <a key={key} href={mark.attrs.href} target="_blank" rel="noreferrer">{value}</a>;
    }
    return value;
  }
  const children = (node.content || []).map((child, index) => renderNode(child, key + '-' + index));
  if (node.type === 'paragraph') return <p key={key}>{children}</p>;
  if (node.type === 'heading') return <h2 key={key}>{children}</h2>;
  if (node.type === 'blockquote') return <blockquote key={key}>{children}</blockquote>;
  if (node.type === 'bulletList') return <ul key={key}>{children}</ul>;
  if (node.type === 'orderedList') return <ol key={key}>{children}</ol>;
  if (node.type === 'listItem') return <li key={key}>{children}</li>;
  if (node.type === 'hardBreak') return <br key={key} />;
  return <>{children}</>;
}

export default function PublicSnapshot({ slug }: { slug: string }) {
  const [publication, setPublication] = useState<any | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    fetch('/api/publications/public/' + encodeURIComponent(slug), { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((value) => setPublication(value.data.publication))
      .catch(() => setMissing(true));
  }, [slug]);
  if (missing) return <main className={styles.missing}>此链接不可用。</main>;
  if (!publication) return <main className={styles.missing}>正在加载…</main>;
  return <main className={styles.page}><article>
    <p className={styles.brand}>由 NoteWithAI 分享</p>
    {publication.title && <h1>{publication.title}</h1>}
    <div className={styles.body}>{(publication.contentSnapshot.content || []).map((node: Node, index: number) => renderNode(node, String(index)))}</div>
    {publication.authorDisplayName && <footer>{publication.authorDisplayName}</footer>}
  </article></main>;
}


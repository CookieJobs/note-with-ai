//frontend/src/components/NoteCard.tsx
'use client';

import styles from './NoteCard.module.scss';
import React from 'react';

interface Props {
  title: string;
  content: string;
  keywords: string[];
  createdAt: string;
  onDelete: () => void;
}

export default function NoteCard({ title, content, keywords, createdAt, onDelete }: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>
        {title}
        <button
          onClick={onDelete}
          style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer', color: '#888' }}
          aria-label="删除笔记"
          title="删除笔记"
        >
          ✕
        </button>
      </div>
      <div className={styles.content}>{content}</div>
      {keywords.length > 0 && (
        <div className={styles.keywords}>
          {keywords.map((kw) => (
            <span key={kw} className={styles.keyword}>
              {kw}
            </span>
          ))}
        </div>
      )}
      <div className={styles.timestamp}>{new Date(createdAt).toLocaleString()}</div>
    </div>
  );
}
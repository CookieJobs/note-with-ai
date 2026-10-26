/*
Input: 笔记开场时保留的来源信息与原文摘录
Output: 与 AI 提问分开的笔记原文区域，支持展开摘录及打开完整笔记
Pos: 聊天开场消息的笔记上下文
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, FileText } from 'lucide-react';
import type { IRelatedNote } from '../types';
import { noteReferenceDisplay } from '../utils/noteReference';
import styles from './ChatOpeningNote.module.scss';

export default function ChatOpeningNote({ note }: { note: IRelatedNote }) {
  const [expanded, setExpanded] = useState(false);
  const excerptId = useId();
  const display = noteReferenceDisplay(note);
  const excerpt = note.excerpt?.trim() || note.content?.trim() || '';
  const characters = Array.from(excerpt);
  const isLong = characters.length > 160;
  const visibleExcerpt = isLong && !expanded ? `${characters.slice(0, 160).join('')}…` : excerpt;
  const noteId = note.noteId || note.id;

  return (
    <section className={styles.note} aria-label="笔记原文">
      <div className={styles.label}>
        <FileText size={16} aria-hidden="true" />
        <span>笔记原文</span>
        {excerpt && <span className={styles.excerptLabel}>摘录</span>}
      </div>
      {note.title?.trim() && <h2 className={styles.title}>{note.title.trim()}</h2>}
      {excerpt && <blockquote id={excerptId} className={styles.excerpt}>{visibleExcerpt}</blockquote>}
      {display.firstImageSrc && <img className={styles.image} src={display.firstImageSrc} alt="笔记中的图片" width={72} height={72} />}
      {isLong && (
        <button type="button" className={styles.expand} aria-expanded={expanded} aria-controls={excerptId} onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起摘录' : '展开摘录'}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
      <div className={styles.footer}>
        {display.dateLabel && <time dateTime={note.createdAt}>{display.dateLabel}</time>}
        {noteId && (
          <Link href={`/notes?highlight=${encodeURIComponent(noteId)}`} className={styles.sourceLink}>
            查看完整笔记 <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  );
}

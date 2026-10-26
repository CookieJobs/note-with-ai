/*
Input: 当前服务端笔记与由页面保护的阅读操作
Output: 按需加载的富文本阅读列；无标题时直接展示正文
Pos: notes/components；修改时同步 ../README.md
*/
'use client';

import { useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Network, Trash2, MessageCircle } from 'lucide-react';
import type { Note } from '../hooks/useNotes';
import RichTextViewer from './RichTextViewer';
import styles from '../NotesWorkspace.module.scss';

type Props = { note: Note; onEdit: () => void; onDelete: (trigger?: HTMLButtonElement | null) => void; onRelated: () => void; relatedOpen: boolean; onDiscuss?: () => void; discussing?: boolean };
export default function NoteWorkspaceReader({ note, onEdit, onDelete, onRelated, relatedOpen, onDiscuss, discussing }: Props) {
  const [more, setMore] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  // The original Markdown remains authoritative over its plain-text projection.
  const value = note.contentJson || note.content || note.contentText || '';
  const date = new Date(note.createdAt);
  const dateLabel = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  return (
    <article aria-label="笔记阅读" className={styles.reader}>
      <div className={styles.readerToolbar}>
        <time dateTime={note.createdAt}>{dateLabel}</time>
        <div className={styles.readerTools}>
          {onDiscuss && <button type="button" className={styles.button} disabled={discussing} onClick={onDiscuss}><MessageCircle size={15} />{discussing ? '正在创建对话…' : '和 AI 讨论'}</button>}
          <button type="button" className={styles.button} onClick={onRelated} aria-pressed={relatedOpen}><Network size={15} />相关笔记</button>
          <button type="button" className={styles.button} onClick={onEdit}><Pencil size={15} />编辑笔记</button>
          <div className={styles.more} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMore(false); }}>
            <button ref={moreTriggerRef} type="button" className={styles.iconButton} aria-label="更多笔记操作" aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(!more)}><MoreHorizontal size={19} /></button>
            {more && <div className={styles.moreMenu} role="menu" onKeyDown={(event) => { if (event.key === 'Escape') { setMore(false); (event.currentTarget.previousElementSibling as HTMLButtonElement)?.focus(); } }}>
              <button type="button" role="menuitem" className={styles.dangerButton} onClick={() => { setMore(false); onDelete(moreTriggerRef.current); }}><Trash2 size={15} />删除笔记</button>
            </div>}
          </div>
        </div>
      </div>
      {note.title?.trim() && <h1>{note.title}</h1>}
      <div className={styles.readingBody}>
        <RichTextViewer value={value} preserveLineBreaks />
      </div>
      <footer className={styles.readingFooter}>创建于 {dateLabel}</footer>
    </article>
  );
}

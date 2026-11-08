'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Note } from '../hooks/useNotes';
import { noteReferenceDisplay } from '../../../utils/noteReference';
import { noteFeedText, placeNoteCards } from '../utils/noteFeed';
import styles from '../NotesWorkspace.module.scss';

function safeImage(src?: string): string | undefined {
  return src && (/^https?:\/\//i.test(src) || /^\/(?!\/)/.test(src) || /^blob:/i.test(src) || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)) ? src : undefined;
}
function Card({ note, onOpen }: { note: Note; onOpen: (id: string) => void }) {
  const display = noteReferenceDisplay(note);
  const image = safeImage(display.firstImageSrc);
  const [failed, setFailed] = useState<string | null>(null);
  const text = noteFeedText(note);
  return <button type="button" className={styles.noteCard} data-note-id={note._id} onClick={() => onOpen(note._id)} aria-label={'阅读笔记：' + display.label}>
    {note.title?.trim() && <span className={styles.cardTitle}>{note.title}</span>}
    {text && <span className={styles.cardExcerpt}>{text}</span>}
    {image && failed !== image && <span className={styles.cardImage}><img src={image} alt="笔记首图" loading="lazy" onError={() => setFailed(image)} /></span>}
    {!text && !note.title?.trim() && (!image || failed === image) && <span className={styles.cardExcerpt}>图片笔记</span>}
    {display.dateLabel && <span className={styles.cardMeta}>{display.dateLabel}</span>}
  </button>;
}
export default function NotesFeed({ notes, onOpen }: { notes: Note[]; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const feed = ref.current;
    if (!feed) return;
    const arrange = () => {
      const cards = Array.from(feed.children) as HTMLElement[];
      if (!cards.length || !feed.clientWidth) return;
      const gap = 20;
      const columns = Math.max(1, Math.min(4, Math.floor((feed.clientWidth + gap) / 300)));
      const width = (feed.clientWidth - (columns - 1) * gap) / columns;
      cards.forEach(card => { card.style.width = width + 'px'; });
      const layout = placeNoteCards(cards.map(card => card.offsetHeight), columns, width, gap);
      cards.forEach((card, i) => { card.style.position = 'absolute'; card.style.left = layout.positions[i].left + 'px'; card.style.top = layout.positions[i].top + 'px'; });
      feed.style.height = layout.height + 'px';
    };
    arrange();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(arrange) : null;
    observer?.observe(feed);
    Array.from(feed.children).forEach(card => observer?.observe(card));
    window.addEventListener('resize', arrange);
    return () => { observer?.disconnect(); window.removeEventListener('resize', arrange); };
  }, [notes]);
  return <div ref={ref} className={styles.noteFeed} aria-label="笔记信息流">{notes.map(note => <Card key={note._id} note={note} onOpen={onOpen} />)}</div>;
}

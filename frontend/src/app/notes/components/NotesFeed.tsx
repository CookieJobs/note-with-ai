'use client';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Note } from '../hooks/useNotes';
import { noteReferenceDisplay } from '../../../utils/noteReference';
import { noteFeedText, placeNoteCards } from '../utils/noteFeed';
import NoteSnow from './NoteSnow';
import { frostCorner, hashSeed } from '../utils/frostArt';
import styles from '../NotesWorkspace.module.scss';

function safeImage(src?: string): string | undefined {
  return src && (/^https?:\/\//i.test(src) || /^\/(?!\/)/.test(src) || /^blob:/i.test(src) || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)) ? src : undefined;
}
type MeltFrost = (id: string) => Promise<number | null>;

function Card({ note, onOpen, onMelt }: { note: Note; onOpen: (id: string) => void; onMelt?: MeltFrost }) {
  const display = noteReferenceDisplay(note);
  const image = safeImage(display.firstImageSrc);
  const [failed, setFailed] = useState<string | null>(null);
  const layers = note.frostLayers ?? 0;
  const [reservedSnowLayers, setReservedSnowLayers] = useState(layers);
  const [pending, setPending] = useState(false);
  const [meltFailed, setMeltFailed] = useState(false);
  const requestInFlight = useRef(false);
  const text = noteFeedText(note);
  // Keep the largest snow header seen on this card until it unmounts.
  const snowHeaderLayers = Math.max(reservedSnowLayers, layers);
  const showSnowHeader = snowHeaderLayers > 0;
  const snowSpace = showSnowHeader ? Math.max(24, frostCorner(snowHeaderLayers).height + 2) : 0;
  useEffect(() => {
    if (layers > reservedSnowLayers) setReservedSnowLayers(layers);
  }, [layers, reservedSnowLayers]);

  const handleClick = async () => {
    if (requestInFlight.current) return;
    if (layers <= 0) { onOpen(note._id); return; }
    if (!onMelt) return;

    requestInFlight.current = true;
    setPending(true);
    setMeltFailed(false);
    try {
      const remaining = await onMelt(note._id);
      if (remaining == null) setMeltFailed(true);
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  };
  const showFailure = layers > 0 && meltFailed;
  const hint = pending ? '正在抖落积雪…' : showFailure ? '抖雪失败 · 点击重试'
    : layers > 0 ? `抖落积雪 · 还剩 ${layers} 层` : '打开笔记';
  const label = layers > 0 ? `抖落积雪（还剩 ${layers} 层）：${display.label}` : '阅读笔记：' + display.label;
  return <div className={styles.cardShell} data-frost={layers} data-snow-header={showSnowHeader || undefined}
    style={showSnowHeader ? { '--card-snow-space': `${snowSpace}px` } as CSSProperties : undefined}>
    <button type="button" className={styles.noteCard} data-note-id={note._id} data-frozen={layers > 0 || undefined}
      onClick={handleClick} aria-label={label} aria-busy={pending || undefined} aria-disabled={pending || undefined}>
      {note.title?.trim() && <span className={styles.cardTitle}>{note.title}</span>}
      {text && <span className={styles.cardExcerpt}>{text}</span>}
      {image && failed !== image && <span className={styles.cardImage}><img src={image} alt="笔记首图" loading="lazy" onError={() => setFailed(image)} /></span>}
      {!text && !note.title?.trim() && (!image || failed === image) && <span className={styles.cardExcerpt}>图片笔记</span>}
      {display.dateLabel && <span className={styles.cardMeta}>{display.dateLabel}</span>}
      {showSnowHeader && <span className={styles.frostHint} role="status" data-feedback={pending || showFailure || undefined}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2v20M4 6l16 12M20 6L4 18M12 5l-2.5-2M12 5l2.5-2M12 19l-2.5 2M12 19l2.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        {hint}
      </span>}
      {showSnowHeader && <NoteSnow layers={layers} seed={hashSeed(note._id)} />}
    </button>
  </div>;
}
export default function NotesFeed({ notes, onOpen, onMelt }: { notes: Note[]; onOpen: (id: string) => void; onMelt?: MeltFrost }) {
  const ref = useRef<HTMLDivElement>(null);
  const cardOrder = JSON.stringify(notes.map(note => note._id));
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
  }, [cardOrder]);
  return <div ref={ref} className={styles.noteFeed} aria-label="笔记信息流">{notes.map(note => <Card key={note._id} note={note} onOpen={onOpen} onMelt={onMelt} />)}</div>;
}

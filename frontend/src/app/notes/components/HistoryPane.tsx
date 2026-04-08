'use client';

import { useEffect, useRef, useState } from 'react';
import { Note } from '../hooks/useNotes';
import { useElasticScroll } from '../hooks/useElasticScroll';
import styles from '../notes.module.scss';

interface HistoryPaneProps {
  notes: Note[];
  selectedNoteId: string | null;
  hoveredNoteId: string | null;
  onSelectNote: (id: string) => void;
  onHoverNote: (id: string | null) => void;
  drafts: Record<string, { json: any; text: string; dirty: boolean }>;
  historyColorMap: Record<string, string>;
  historyCollapsed: boolean;
  highlightId?: string;
}

export default function HistoryPane({
  notes,
  selectedNoteId,
  hoveredNoteId,
  onSelectNote,
  onHoverNote,
  drafts,
  historyColorMap,
  historyCollapsed,
  highlightId,
}: HistoryPaneProps) {
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const historyPaneRef = useRef<HTMLDivElement | null>(null);
  const [collapsedLabel, setCollapsedLabel] = useState<{ noteId: string; title: string; top: number } | null>(null);
  const highlightedRef = useRef<HTMLDivElement | null>(null);

  const historyBounceLockRef = useElasticScroll(historyScrollRef);

  const hasAnyDraft = Object.values(drafts).some((d) => d?.dirty);

  // 历史栏收起时的 Label 显示逻辑
  useEffect(() => {
    if (!historyCollapsed) {
      setCollapsedLabel(null);
      return;
    }

    const fallbackId = notes && notes.length > 0 ? notes[0]._id : null;
    const targetId = hoveredNoteId || selectedNoteId || fallbackId;
    if (!targetId) {
      setCollapsedLabel(null);
      return;
    }

    const pane = historyPaneRef.current;
    const pr = pane?.getBoundingClientRect();
    const noteIdx = notes ? notes.findIndex((n) => n._id === targetId) : -1;
    const note = noteIdx >= 0 ? notes[noteIdx] : null;
    const title = ((note?.title || '').trim() || '未命名').trim();

    const item = document.getElementById(`history-${targetId}`);
    if (pr && item) {
      const ir = item.getBoundingClientRect();
      const top = ir.top - pr.top + ir.height / 2;
      setCollapsedLabel({ noteId: targetId, title, top });
      return;
    }

    if (pr && noteIdx >= 0) {
      const top = 8 + noteIdx * (30 + 8) + 30 / 2;
      setCollapsedLabel({ noteId: targetId, title, top });
      return;
    }

    setCollapsedLabel(null);
  }, [historyCollapsed, hoveredNoteId, selectedNoteId, notes]);

  // Highlight 逻辑
  useEffect(() => {
    if (!highlightId || notes.length === 0) return;
    const timer = setTimeout(() => {
      if (highlightedRef.current) {
        highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [highlightId, notes]);

  const attachRefIfHighlighted = (id: string) => (el: HTMLDivElement | null) => {
    if (!highlightId) return;
    if (id === highlightId) {
      highlightedRef.current = el;
      if (el) {
        el.classList.add(styles.historyItemHighlight);
        setTimeout(() => {
          el && el.classList.remove(styles.historyItemHighlight);
        }, 3000);
      }
    }
  };

  // 自动滚动到选中项
  useEffect(() => {
    if (!selectedNoteId) return;
    const el = document.getElementById(`history-${selectedNoteId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedNoteId]);

  return (
    <aside
      ref={historyPaneRef}
      className={`${styles.historyPane} ${styles.historyPaneFrozen} ${historyCollapsed ? styles.historyPaneCollapsed : ''} ${
        historyCollapsed && hoveredNoteId ? styles.historyPaneHovering : ''
      }`}
      aria-label="历史笔记列表"
    >
      <div className={styles.historyPaneHeader}>
        <div className={styles.historyPaneTitle}>
          历史笔记
          {hasAnyDraft && <span className={styles.historyPaneDraftDot} aria-label="有草稿" />}
        </div>
        <div className={styles.historyPaneCount}>{notes.length}</div>
      </div>

      <div className={styles.historyScroll} ref={historyScrollRef}>
        {notes.map((note) => {
          const isSelected = selectedNoteId === note._id;
          const title = (note.title || '').trim() || '未命名';
          const draft = drafts[note._id];
          const previewSource = draft?.dirty ? (draft.text || '') : (note.contentText || note.content || '');
          const preview = previewSource.trim().replace(/\s+/g, ' ').slice(0, 56);
          const hasDraft = !!drafts[note._id]?.dirty;

          return (
            <div
              key={note._id}
              id={`history-${note._id}`}
              ref={attachRefIfHighlighted(note._id)}
              className={`${styles.historyItem} ${isSelected ? styles.historyItemSelected : ''} ${
                hoveredNoteId === note._id ? styles.historyItemHovered : ''
              }`}
              data-selected={isSelected ? 'true' : undefined}
              style={
                historyColorMap[note._id]
                  ? ({ ['--history-accent' as any]: historyColorMap[note._id] } as any)
                  : undefined
              }
              role="button"
              tabIndex={0}
              onMouseEnter={() => {
                if (historyBounceLockRef.current) return;
                onHoverNote(note._id);
              }}
              onMouseLeave={() => {
                if (historyBounceLockRef.current) return;
                if (hoveredNoteId === note._id) {
                  onHoverNote(null);
                }
              }}
              onClick={() => onSelectNote(note._id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSelectNote(note._id);
                }
              }}
              title={title}
            >
              <div className={styles.historyItemTitleRow}>
                <div className={styles.historyItemTitle}>{title}</div>
                {hasDraft && <div className={styles.historyItemDraft}>草稿未保存</div>}
                {note.enriching && <div className={styles.historyItemDot} title="AI 处理中" />}
              </div>
              <div className={styles.historyItemPreview}>{preview || '（空）'}</div>
              <div className={styles.historyItemHoverLabel}>{title}</div>
            </div>
          );
        })}
      </div>
      {historyCollapsed && collapsedLabel && collapsedLabel.title && (
        <div
          className={styles.historyCollapsedLabelWrap}
          style={{
            top: collapsedLabel.top,
            ...(collapsedLabel.noteId && historyColorMap[collapsedLabel.noteId]
              ? ({ ['--history-accent' as any]: historyColorMap[collapsedLabel.noteId] } as any)
              : undefined),
          }}
        >
          <span className={styles.historyCollapsedLabelGlow} />
          <div className={styles.historyCollapsedLabel}>{collapsedLabel.title}</div>
        </div>
      )}
    </aside>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSearch, Loader2, X } from 'lucide-react';
import ReferenceNote from '../../../components/ReferenceNote';
import styles from '../../../components/RelatedNotes.module.scss';
import { usePanelDismiss } from '../../../hooks/usePanelDismiss';
import type { Note } from '../hooks/useNotes';
import { getRecommendCacheState, hasCandidateS1 } from '../utils/recommendCache';
import { authFetch } from '../../../utils/auth';
import { fetchRelatedNoteSummaries } from '../services/relatedNotes';
import { noteReferenceDisplay } from '../../../utils/noteReference';

interface RelatedNotesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenNote?: (noteId: string) => void;
  selectedNoteId: string | null;
  allNotes: Note[];
  onRefreshRecommendCache?: (noteId: string) => Promise<void>;
}

interface RelatedNoteItem {
  id: string;
  note: Note;
  type: string;
  reason: string;
}

export default function RelatedNotesDrawer({ 
  isOpen, 
  onClose,
  onOpenNote,
  selectedNoteId,
  allNotes,
  onRefreshRecommendCache,
}: RelatedNotesDrawerProps) {
  const router = useRouter();
  const { panelRef, isModal } = usePanelDismiss(isOpen, onClose, 1199);
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'success' | 'error'>('idle');
  const [remoteRelated, setRemoteRelated] = useState<RelatedNoteItem[] | null>(null);
  const lastAttemptKeyRef = useRef<string | null>(null);

  const currentNote = useMemo(
    () => (selectedNoteId ? allNotes.find((n) => n._id === selectedNoteId) ?? null : null),
    [selectedNoteId, allNotes]
  );
  const cacheState = useMemo(() => getRecommendCacheState(currentNote), [currentNote]);

  useEffect(() => {
    if (!isOpen) {
      setRefreshState('idle');
      lastAttemptKeyRef.current = null;
      return;
    }
    setRefreshState('idle');
  }, [selectedNoteId, isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedNoteId) {
      setRemoteRelated(null);
      return;
    }
    // The cache is revision-scoped. Clear the old projection immediately when
    // a write advances the selected note while this drawer is still open.
    setRemoteRelated(null);
    let cancelled = false;
    void fetchRelatedNoteSummaries(selectedNoteId, authFetch)
      .then((summaries) => {
        if (cancelled) return;
        setRemoteRelated(summaries.map((item) => ({
          id: item.noteId,
          note: { _id: item.noteId, title: item.title, contentText: item.contentText, content: item.contentText, excerpt: item.excerpt, createdAt: item.createdAt, sourceType: item.sourceType, imageCount: item.imageCount, firstImageSrc: item.firstImageSrc } as Note,
          type: item.type,
          reason: item.reason,
        })));
      })
      .catch(() => { if (!cancelled) setRemoteRelated([]); });
    return () => { cancelled = true; };
  }, [isOpen, selectedNoteId, currentNote?.revision, currentNote?.recommendCache?.generatedAt]);

  useEffect(() => {
    if (!isOpen || !currentNote || !onRefreshRecommendCache || !cacheState.needsRefresh) return;

    const attemptKey = [
      currentNote._id,
      currentNote.revision,
      currentNote.updatedAt || '',
      currentNote.recommendCache?.sourceRevision ?? '',
      currentNote.recommendCache?.sourceUpdatedAt || '',
      currentNote.recommendCache?.generatedAt || '',
      cacheState.status,
    ].join(':');

    if (lastAttemptKeyRef.current === attemptKey) return;
    lastAttemptKeyRef.current = attemptKey;

    let cancelled = false;
    setRefreshState('refreshing');

    void onRefreshRecommendCache(currentNote._id)
      .then(() => {
        if (cancelled) return;
        setRefreshState('success');
      })
      .catch(() => {
        if (cancelled) return;
        setRefreshState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [cacheState.needsRefresh, cacheState.status, currentNote, isOpen, onRefreshRecommendCache]);

  // The current cached relation can be shown while the independent summary
  // request is in flight, but its ranking diagnostics are never user-facing.
  const localRelatedNotes = useMemo(() => {
    if (!currentNote || !currentNote.recommendCache?.byCandidateId) {
      return [];
    }

    const byCandidateId = currentNote.recommendCache.byCandidateId;
    
    const candidates = Object.entries(byCandidateId)
      .flatMap(([id, data]: [string, any]) => {
        const note = allNotes.find(n => String(n._id) === String(id));
        const s1 = hasCandidateS1(data) ? Number(data.s1) : 0;
        const s2 = Number(data.s2 || 0);
        const passesExistingThreshold = s2 >= 0.7;
        if (!note || !passesExistingThreshold || data.type === '弱关联') return [];
        return [{
          item: {
            id,
            note,
            type: data.type || '',
            reason: data.reason || ''
          },
          rankScore: 0.3 * s1 + 0.7 * s2,
        }];
      });

    return candidates
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, 5)
      .map(({ item }) => item);
  }, [allNotes, currentNote]);
  const relatedNotes = remoteRelated ?? localRelatedNotes;

  const showRefreshingMessage = refreshState === 'refreshing';
  const showRefreshSuccess = refreshState === 'success' && cacheState.status !== 'current-empty';
  const showRefreshError = refreshState === 'error';
  const showLoadingState = relatedNotes.length === 0 && (showRefreshingMessage || (cacheState.status === 'missing' && !showRefreshError));
  const showResolvedEmptyState = relatedNotes.length === 0 && !showLoadingState;

  if (!isOpen) return null;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} tabIndex={-1} className={`${styles.panel} ${styles.drawer}`} role={isModal ? 'dialog' : 'complementary'} aria-modal={isModal || undefined} aria-label="相关笔记">
        <div className={styles.header}>
          <h2>相关笔记 <span className={styles.count}>{relatedNotes.length || ''}</span></h2>
          <button type="button" onClick={onClose} className={styles.close} aria-label="关闭"><X size={18} /></button>
        </div>
        <p className={styles.intro}>沿着一条记录，发现更多联系。{currentNote && <span className={styles.source}>{noteReferenceDisplay(currentNote).label}</span>}</p>
        {(showRefreshingMessage || showRefreshSuccess || showRefreshError) && (
          <div role="status" className={`${styles.status} ${showRefreshError ? styles.statusError : ''}`}>
            {showRefreshError ? '推荐刷新失败，请稍后重试' : showRefreshSuccess ? '相关推荐已更新' : '正在刷新相关推荐...'}
          </div>
        )}
        <div className={styles.list}>
          {relatedNotes.length > 0 ? relatedNotes.map(item => (
            <ReferenceNote key={item.id} title={item.note.title} excerpt={item.note.excerpt} contentText={item.note.contentText || item.note.content} contentJson={item.note.contentJson} sourceType={item.note.sourceType} imageCount={item.note.imageCount} firstImageSrc={item.note.firstImageSrc} createdAt={item.note.createdAt} relation={item.type} reason={item.reason} onOpen={() => { if (onOpenNote) onOpenNote(item.id); else { onClose(); router.push(`/notes?highlight=${item.id}`); } }} />
          )) : showLoadingState ? (
            <div className={styles.empty} role="status"><Loader2 className={styles.spinner} size={24} /><h3>正在计算相关推荐</h3><p>正在整理与这条笔记有关的内容，完成后会在这里显示。</p></div>
          ) : showResolvedEmptyState ? (
            <div className={styles.empty}><FileSearch size={24} strokeWidth={1.5} /><h3>暂无关联笔记</h3><p>还没有找到合适的关联。继续记录想法，新的联系会在这里出现。</p></div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

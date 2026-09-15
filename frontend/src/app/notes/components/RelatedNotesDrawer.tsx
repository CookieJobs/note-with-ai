import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogClose, DialogTitle, DrawerContent } from '@/components/ui/dialog';
import { RelationshipCue } from '@/components/ui/relationship-cue';
import type { Note } from '../hooks/useNotes';
import { fetchRelatedNotes, type RelatedNoteSummary } from '../services/relatedNotes';
import { getRecommendCacheState } from '../utils/recommendCache';

interface RelatedNotesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNote: Note | null;
  onRefreshRecommendCache?: (noteId: string) => Promise<void>;
}

type RequestState = 'idle' | 'loading' | 'success' | 'error';
type RefreshState = 'idle' | 'refreshing' | 'error';
type RelationshipRequest = { sourceIdentity: string | null; status: RequestState; relationships: RelatedNoteSummary[]; error: Error | null };

function relationshipStrengthLabel(scoreBand: RelatedNoteSummary['scoreBand']): string {
  return scoreBand === 'supported' ? '关联线索较强' : '可能相关';
}

export default function RelatedNotesDrawer({
  isOpen,
  onClose,
  selectedNote,
  onRefreshRecommendCache,
}: RelatedNotesDrawerProps) {
  const [relationshipRequest, setRelationshipRequest] = useState<RelationshipRequest>({ sourceIdentity: null, status: 'idle', relationships: [], error: null });
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [reloadKey, setReloadKey] = useState(0);
  const lastAttemptKeyRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const cacheState = useMemo(() => getRecommendCacheState(selectedNote), [selectedNote]);
  const selectedNoteId = selectedNote?._id;
  const selectedSourceRevision = selectedNote?.revision;
  const selectedSourceIdentity = selectedNoteId && selectedSourceRevision !== undefined
    ? `${selectedNoteId}:${selectedSourceRevision}`
    : null;

  if (isOpen && !wasOpenRef.current && typeof document !== 'undefined') {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = isOpen;

  useEffect(() => {
    if (isOpen && !selectedNote) onClose();
  }, [isOpen, onClose, selectedNote]);

  useEffect(() => {
    if (!isOpen) {
      setRefreshState('idle');
      lastAttemptKeyRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedNoteId) {
      setRelationshipRequest({ sourceIdentity: null, status: 'idle', relationships: [], error: null });
      return;
    }

    const controller = new AbortController();
    setRelationshipRequest({ sourceIdentity: selectedSourceIdentity, status: 'loading', relationships: [], error: null });
    void fetchRelatedNotes(selectedNoteId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || response.sourceRevision !== selectedSourceRevision) return;
        setRelationshipRequest({ sourceIdentity: selectedSourceIdentity, status: 'success', relationships: response.relationships, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRelationshipRequest({ sourceIdentity: selectedSourceIdentity, status: 'error', relationships: [], error: error instanceof Error ? error : new Error('相关笔记请求失败') });
      });

    return () => controller.abort();
  }, [isOpen, reloadKey, selectedNoteId, selectedSourceIdentity, selectedSourceRevision]);

  useEffect(() => {
    if (!isOpen || !selectedNote || !onRefreshRecommendCache || !cacheState.needsRefresh) return;
    const attemptKey = `${selectedNote._id}:${selectedNote.revision}`;
    if (lastAttemptKeyRef.current === attemptKey) return;

    lastAttemptKeyRef.current = attemptKey;
    let cancelled = false;
    setRefreshState('refreshing');
    void onRefreshRecommendCache(selectedNote._id)
      .then(() => {
        if (cancelled) return;
        setRefreshState('idle');
        setReloadKey((value) => value + 1);
      })
      .catch(() => {
        if (cancelled) return;
        setRefreshState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [cacheState.needsRefresh, isOpen, onRefreshRecommendCache, selectedNote]);

  const sourceLabel = selectedNote?.title || '当前笔记';
  const activeRequest: RelationshipRequest = relationshipRequest.sourceIdentity === selectedSourceIdentity
    ? relationshipRequest
    : { sourceIdentity: selectedSourceIdentity, status: selectedSourceIdentity ? 'loading' : 'idle', relationships: [], error: null };
  const showLoading = activeRequest.status === 'idle' || activeRequest.status === 'loading';
  const relationships = activeRequest.relationships;

  return (
    <Dialog open={isOpen && !!selectedNote} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className="w-[min(100%,25rem)] max-w-[calc(100%-1rem)] gap-0 overflow-hidden p-0"
      >
        <header className="flex items-center justify-between border-b px-5 py-4 [border-color:var(--color-border-default)]">
          <DialogTitle className="text-lg font-semibold">相关笔记</DialogTitle>
          <DialogClose asChild>
            <button type="button" className="min-h-11 min-w-11 rounded-[var(--radius-md)] [color:var(--color-text-secondary)] hover:[background:var(--color-surface-subtle)]" aria-label="关闭相关笔记">
              <span aria-hidden="true">×</span>
            </button>
          </DialogClose>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {refreshState === 'refreshing' ? (
            <p role="status" className="m-0 text-sm [color:var(--color-text-secondary)]">正在更新相关笔记…</p>
          ) : null}
          {refreshState === 'error' ? (
            <p role="status" className="m-0 text-sm [color:var(--color-status-warning)]">相关推荐更新失败，显示当前可用结果。</p>
          ) : null}

          {showLoading ? (
            <div role="status" className="py-12 text-center text-sm [color:var(--color-text-secondary)]">正在加载相关笔记…</div>
          ) : null}

          {activeRequest.status === 'error' ? (
            <div role="alert" className="grid gap-3 py-12 text-center">
              <p className="m-0 text-sm [color:var(--color-text-secondary)]">无法加载相关笔记，请稍后重试。</p>
              <button type="button" className="min-h-11 justify-self-center rounded-[var(--radius-md)] px-3 text-sm font-medium [background:var(--color-action-secondary)] [color:var(--color-text-primary)]" onClick={() => setReloadKey((value) => value + 1)}>重试</button>
            </div>
          ) : null}

          {activeRequest.status === 'success' && relationships.length === 0 ? (
            <div className="py-12 text-center">
              <p className="m-0 text-sm font-medium [color:var(--color-text-secondary)]">暂无相关笔记</p>
              <p className="mt-2 text-xs [color:var(--color-text-tertiary)]">这条笔记暂时没有可展示的关联结果。</p>
            </div>
          ) : null}

          {relationships.map((relationship) => (
            <article key={relationship.id} className="grid gap-3 rounded-[var(--radius-lg)] border p-4 [background:var(--color-surface-subtle)] [border-color:var(--color-border-default)]">
              <RelationshipCue
                sourceLabel={sourceLabel}
                targetLabel={relationship.title || '无标题'}
                href={`/notes?highlight=${encodeURIComponent(relationship.id)}`}
                linkClassName="inline-flex min-h-11 min-w-11 items-center rounded-[var(--radius-md)] px-2 font-medium [color:var(--color-action-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]"
                onLinkClick={onClose}
                kind={relationship.type || undefined}
                explanation={relationship.reason || undefined}
              />
              <p className="m-0 text-xs [color:var(--color-text-tertiary)]">{relationshipStrengthLabel(relationship.scoreBand)}</p>
              {relationship.contentText ? <p className="m-0 line-clamp-3 text-sm [color:var(--color-text-secondary)]">{relationship.contentText}</p> : null}
            </article>
          ))}
        </div>
      </DrawerContent>
    </Dialog>
  );
}

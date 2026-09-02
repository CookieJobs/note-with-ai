import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NoteRelationship } from '../types/relationships';
import type { RelationshipRecommendCache } from '../utils/recommendCache';
import type { Note } from '../hooks/useNotes';
import { authFetch } from '../../../utils/auth';
import RelationshipCard from './RelationshipCard';

type Feedback = 'helpful' | 'not_relevant' | 'hide_pair';

interface RelatedNotesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNoteId: string | null;
  allNotes: Note[];
  onRefreshRecommendCache?: (noteId: string) => Promise<void>;
  onContinueWriting?: (relationship: NoteRelationship) => void;
  onStartChat?: (relationship: NoteRelationship) => void;
}

function isCurrentRelationship(relationship: NoteRelationship, notes: Note[]) {
  return [relationship.source, relationship.candidate].every((evidence) => {
    const note = notes.find((item) => item._id === evidence.noteId);
    return note && note.revision === evidence.revision && (note.contentText || note.content || '').includes(evidence.excerpt);
  });
}

export default function RelatedNotesDrawer({ isOpen, onClose, selectedNoteId, allNotes, onRefreshRecommendCache, onContinueWriting, onStartChat }: RelatedNotesDrawerProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [feedbackError, setFeedbackError] = useState('');
  const currentNote = useMemo(() => selectedNoteId ? allNotes.find((note) => note._id === selectedNoteId) ?? null : null, [allNotes, selectedNoteId]);
  const relationships = useMemo(() => {
    const entries = (currentNote?.recommendCache as RelationshipRecommendCache | null | undefined)?.relationships || [];
    return entries.filter((relationship) => isCurrentRelationship(relationship, allNotes));
  }, [allNotes, currentNote]);

  const submitFeedback = async (relationship: NoteRelationship, verdict: Feedback) => {
    setFeedbackError('');
    const previousFeedback = feedback[relationship.relationshipId];
    setFeedback((current) => ({ ...current, [relationship.relationshipId]: verdict }));
    try {
      const response = await authFetch(`/api/recommend/relationships/${encodeURIComponent(relationship.relationshipId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceNoteId: relationship.source.noteId, candidateNoteId: relationship.candidate.noteId, sourceRevision: relationship.source.revision, candidateRevision: relationship.candidate.revision, verdict }),
      });
      if (!response.ok) throw new Error('反馈暂时无法保存');
      if (verdict !== 'helpful' && currentNote && onRefreshRecommendCache) await onRefreshRecommendCache(currentNote._id);
    } catch (error) {
      setFeedback((current) => {
        const next = { ...current };
        if (previousFeedback) next[relationship.relationshipId] = previousFeedback;
        else delete next[relationship.relationshipId];
        return next;
      });
      setFeedbackError(error instanceof Error ? error.message : '反馈暂时无法保存');
      throw error;
    }
  };

  return (
    <>
      {isOpen && <button type="button" aria-label="关闭关系线索" className="fixed inset-0 z-[1000] cursor-default bg-black/10 backdrop-blur-[2px]" onClick={onClose} />}
      <aside aria-label="关系线索" className={`fixed top-3 right-3 bottom-3 z-[1001] flex w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-gray-200/50 bg-white/95 shadow-xl transition-transform duration-300 motion-reduce:transition-none ${isOpen ? 'translate-x-0' : 'translate-x-[calc(100%+12px)]'}`}>
        <header className="flex items-center justify-between border-b border-gray-100 p-4">
          <div><h2 className="text-lg font-semibold text-gray-900">关系线索</h2><p className="mt-1 text-xs text-gray-500">来自两篇原文的可验证联系</p></div>
          <button type="button" className="min-h-11 min-w-11 rounded-full text-xl text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="关闭关系线索">×</button>
        </header>
        {feedbackError && <div role="status" className="mx-4 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedbackError}</div>}
        <div className="flex-1 overflow-y-auto p-4">
          {relationships.length > 0 ? relationships.map((relationship) => (
            <div key={relationship.relationshipId} className="mb-4 last:mb-0">
              <RelationshipCard relationship={relationship} selectedFeedback={feedback[relationship.relationshipId]} onFeedback={(verdict) => submitFeedback(relationship, verdict)} onOpenSource={() => { onClose(); router.push(`/notes?highlight=${relationship.candidate.noteId}`); }} onContinueWriting={(value) => onContinueWriting?.(value)} onStartChat={(value) => onStartChat?.(value)} />
            </div>
          )) : <div className="flex min-h-48 flex-col items-center justify-center text-center text-gray-500"><p className="font-medium">联系正在形成</p><p className="mt-2 max-w-[240px] text-sm leading-6">继续自然记录，明确的联系会慢慢出现。</p></div>}
        </div>
      </aside>
    </>
  );
}

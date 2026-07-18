import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Note } from '../hooks/useNotes';
import { getRecommendCacheState, hasCandidateS1 } from '../utils/recommendCache';

interface RelatedNotesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNoteId: string | null;
  allNotes: Note[];
  onRefreshRecommendCache?: (noteId: string, noteUpdatedAt?: string) => Promise<void>;
}

interface RelatedNoteItem {
  id: string;
  note: Note;
  s1: number | null;
  s2: number;
  finalScore: number;
  type: string;
  reason: string;
}

export default function RelatedNotesDrawer({ 
  isOpen, 
  onClose, 
  selectedNoteId,
  allNotes,
  onRefreshRecommendCache,
}: RelatedNotesDrawerProps) {
  const router = useRouter();
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'success' | 'error'>('idle');
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
    if (!isOpen || !currentNote || !onRefreshRecommendCache || !cacheState.needsRefresh) return;

    const attemptKey = [
      currentNote._id,
      currentNote.updatedAt || '',
      currentNote.recommendCache?.sourceUpdatedAt || '',
      currentNote.recommendCache?.generatedAt || '',
      cacheState.status,
    ].join(':');

    if (lastAttemptKeyRef.current === attemptKey) return;
    lastAttemptKeyRef.current = attemptKey;

    let cancelled = false;
    setRefreshState('refreshing');

    void onRefreshRecommendCache(currentNote._id, currentNote.updatedAt)
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

  // 直接利用本地缓存中的大模型打分进行关联推荐，无需发网络请求
  const relatedNotes = useMemo(() => {
    if (!currentNote || !currentNote.recommendCache?.byCandidateId) {
      return [];
    }

    const byCandidateId = currentNote.recommendCache.byCandidateId;
    
    // 提取并过滤已经被删除的笔记
    const candidates: RelatedNoteItem[] = Object.entries(byCandidateId)
      .map(([id, data]: [string, any]) => {
        const note = allNotes.find(n => String(n._id) === String(id));
        const s1 = hasCandidateS1(data) ? Number(data.s1) : null;
        const s2 = data.s2 || 0;
        // 最终融合得分计算公式：0.3 * s1 + 0.7 * s2
        const finalScore = 0.3 * (s1 ?? 0) + 0.7 * s2;

        return {
          id,
          note: note as Note,
          s1,
          s2,
          finalScore,
          type: data.type || '',
          reason: data.reason || ''
        };
      })
      .filter(item => item.note != null);

    // 按照最终融合得分降序排列，只展示大模型得分较高且不为“弱关联”的笔记，取前 5 篇
    // 提高门槛：s2 必须大于等于 0.7 才能被视为强相关
    const related = candidates
      .filter(c => c.s2 >= 0.7 && c.type !== '弱关联')
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 5);

    return related;
  }, [allNotes, currentNote]);

  const showRefreshingMessage = refreshState === 'refreshing';
  const showRefreshSuccess = refreshState === 'success' && cacheState.status !== 'current-empty';
  const showRefreshError = refreshState === 'error';
  const showLoadingState = relatedNotes.length === 0 && (showRefreshingMessage || cacheState.status === 'missing');
  const showResolvedEmptyState = relatedNotes.length === 0 && !showLoadingState;

  const formatMetric = (value: number | null) => (value == null ? '--' : value.toFixed(2));

  return (
    <>
      {/* 遮罩层：点击外部关闭抽屉 */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-[1000] bg-black/10 backdrop-blur-[2px] transition-opacity" 
          onClick={onClose}
        />
      )}
      {/* 侧边栏抽屉本体 — 浮出卡片效果 */}
      <div
        className={`fixed top-3 right-3 bottom-3 w-[360px] md:w-[400px] bg-white/85 backdrop-blur-xl border border-gray-200/30 shadow-xl z-[1001] transform transition-transform duration-300 ease-in-out flex flex-col rounded-2xl overflow-hidden ${isOpen ? 'translate-x-0' : 'translate-x-[calc(100%+12px)]'}`}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">相关笔记</h2>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors border-none bg-transparent outline-none"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        {(showRefreshingMessage || showRefreshSuccess || showRefreshError) && (
          <div className={`mx-6 mt-4 rounded-xl px-4 py-3 text-sm ${
            showRefreshError
              ? 'bg-amber-50 text-amber-700'
              : showRefreshSuccess
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-blue-50 text-blue-700'
          }`}>
            {showRefreshError
              ? '推荐刷新失败，请稍后重试'
              : showRefreshSuccess
                ? '相关推荐已更新'
                : '正在刷新相关推荐...'}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {relatedNotes.length > 0 ? (
            relatedNotes.map(item => (
              <div 
                key={item.id} 
                className="p-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-white hover:shadow-sm hover:border-gray-200 transition-all cursor-pointer flex flex-col gap-2"
                onClick={() => {
                  onClose();
                  router.push(`/notes?highlight=${item.id}`);
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-gray-900 truncate flex-1">{item.note.title || '无标题'}</div>
                  {item.type && (
                    <span className="shrink-0 bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 text-[10px] font-medium border-none">
                      {item.type}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-gray-400 font-mono bg-gray-100/50 p-1.5 rounded-lg border border-gray-100">
                  <div className="flex flex-col">
                    <span className="text-gray-500 font-semibold text-[11px]">{item.finalScore.toFixed(2)}</span>
                    <span>综合分</span>
                  </div>
                  <div className="w-px h-6 bg-gray-200"></div>
                  <div className="flex flex-col">
                    <span className="text-gray-500 font-semibold text-[11px]">{formatMetric(item.s1)}</span>
                    <span>向量(s1)</span>
                  </div>
                  <div className="w-px h-6 bg-gray-200"></div>
                  <div className="flex flex-col">
                    <span className="text-gray-500 font-semibold text-[11px]">{item.s2.toFixed(2)}</span>
                    <span>模型(s2)</span>
                  </div>
                </div>
                <div className="text-sm text-gray-600 line-clamp-3">
                  {item.note.contentText || item.note.content || '暂无内容...'}
                </div>
                {item.reason && (
                  <div className="mt-2 text-xs text-gray-400 bg-gray-100/50 p-2 rounded-lg leading-relaxed">
                    💡 {item.reason}
                  </div>
                )}
              </div>
            ))
          ) : showLoadingState ? (
            <div className="flex flex-col items-center justify-center text-center mt-20 gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
              <div className="text-gray-600 font-medium">正在计算相关推荐</div>
              <div className="text-xs text-gray-400 max-w-[220px]">
                这条笔记的旧缓存正在刷新，稍后会显示最新的向量分数和相关结果
              </div>
            </div>
          ) : showResolvedEmptyState ? (
            <div className="flex flex-col items-center justify-center text-center mt-20 gap-3">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-300" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <circle cx="10" cy="13" r="2"></circle>
                <line x1="11.4" y1="14.4" x2="15" y2="18"></line>
              </svg>
              <div className="text-gray-500 font-medium">暂无强相关的笔记内容</div>
              <div className="text-xs text-gray-400 max-w-[200px]">
                后台可能正在异步计算中，或者该笔记内容尚未达到强关联阈值
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import TopNavigation from '../../components/TopNavigation';
import { getUser, isAuthenticated } from '../../utils/auth';

import DeleteNoteConfirmModal from './components/v2/DeleteNoteConfirmModal';
import ModernNoteCard from './components/v2/ModernNoteCard';
import FloatingQuickCompose from './components/v2/FloatingQuickCompose';
import RelatedNotesDrawer from './components/v2/RelatedNotesDrawer';
import { useAuthGuard } from './hooks/useAuthGuard';
import { useCreateNote } from './hooks/useCreateNote';
import { useNotes } from './hooks/useNotes';
import styles from './notes-v2.module.scss';

// 是 Next.js App Router 的一个“路由段配置”，用来告诉 Next.js：
// 这个页面要强制走动态渲染（不要被静态生成/缓存成固定 HTML）
export const dynamic = 'force-dynamic';

function NotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  
  // 删除确认弹窗
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  // 正文编辑态
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // 鉴权守卫
  const user = useAuthGuard({
    isAuthenticated,
    getUser,
    routerPush: router.push,
    redirectTo: '/auth',
  });

  // 选中笔记状态（侧边栏抽屉）
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // 数据逻辑 Hook
  const {
    notes,
    setNotes,
    isLoading,
    deleteNote,
    updateTitle: handleUpdateTitle,
    updateContent: handleUpdateContent,
    updateKeywords: handleUpdateKeywords,
  } = useNotes(user, { onError: setError });

  // 新建笔记 Hook
  const {
    newContentText,
    setNewContentText,
    newContentJson,
    setNewContentJson,
    loading: createLoading,
    handleSubmit,
  } = useCreateNote(setNotes, { onError: setError });

  const buildJsonFromPlain = (plainText: string) => {
    const t = plainText || '';
    return {
      type: 'doc',
      content: t.split('\n').map((p) => ({
        type: 'paragraph',
        content: p ? [{ type: 'text', text: p }] : [],
      })),
    };
  };

  const highlightId = searchParams.get('highlight') || '';
  const [drafts, setDrafts] = useState<Record<string, { json: any; text: string; dirty: boolean }>>({});
  const [exitEditSignal, setExitEditSignal] = useState(0);
  
  // 用于存储笔记 DOM 节点的引用，实现自动滚动
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // 滚动容器引用
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // 监听 highlightId 的变化，如果存在则自动滚动到对应的笔记
  useEffect(() => {
    if (!highlightId) return;

    let rafId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const scheduleScroll = () => {
      timerId = setTimeout(() => {
        if (cancelled) return;

        const el = noteRefs.current[highlightId];
        const container = scrollContainerRef.current;
        if (!el || !container) return;

        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const relativeTop = elRect.top - containerRect.top + container.scrollTop;

        const yOffset = 40;
        const targetScrollTop = relativeTop - yOffset;

        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        });
      }, 50);
    };

    if (noteRefs.current[highlightId] && scrollContainerRef.current) {
      rafId = requestAnimationFrame(scheduleScroll);
    }

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (timerId != null) clearTimeout(timerId);
    };
  }, [highlightId, notes]);

  const handleDraftChange = (id: string, draft: { json: any; text: string; dirty: boolean }) => {
    setDrafts((prev) => {
      if (!draft.dirty) {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: draft };
    });
  };

  // 详情浮层关闭逻辑
  useEffect(() => {
    if (!editingNoteId) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;

      if (t.closest(`.${styles.noteCardEditing}`)) return;
      if (t.closest(`.${styles.inlineCompose}`)) return;

      setExitEditSignal((v) => v + 1);
      setEditingNoteId(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editingNoteId]);

  return (
    <div className={`${styles.container} !bg-none !bg-gray-50`}>
      <TopNavigation />
      <main className={styles.mainContent}>
        <div className={styles.contentWrapper}>
          {error && (
            <div className={styles.errorBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 9v4m0 4h.01M10.29 3.86l-7.5 12.99A1 1 0 003.62 18h16.76a1 1 0 00-.86-1.5l-7.5-12.99a1 1 0 00-1.72 0z" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {isLoading && notes.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-gray-500">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
              <span>正在加载笔记...</span>
            </div>
          ) : (
            <div className={styles.feedLayout}>
              <div 
                className={styles.feedContainer}
                ref={scrollContainerRef}
              >
                <div className={styles.feedList}>
                  <FloatingQuickCompose
                    valueJson={newContentJson ?? buildJsonFromPlain(newContentText)}
                    valueText={newContentText}
                    onChange={({ json, text }) => {
                      setNewContentJson(json);
                      setNewContentText(text);
                    }}
                    onSubmit={handleSubmit}
                    onCancel={() => {
                      setNewContentText('');
                      setNewContentJson(null);
                    }}
                    loading={createLoading}
                  />

                  {notes.map((note) => (
                    <div 
                      key={note._id} 
                      ref={el => { noteRefs.current[note._id] = el; }}
                    >
                      <ModernNoteCard
                        note={note}
                        onRequestDelete={(id) => {
                          setPendingDeleteNoteId(id);
                        }}
                        onUpdateTitle={handleUpdateTitle}
                        onUpdateContent={handleUpdateContent}
                        onUpdateKeywords={handleUpdateKeywords}
                        draft={drafts[note._id]}
                        onDraftChange={handleDraftChange}
                        exitEditSignal={exitEditSignal}
                        isHighlighted={note._id === highlightId}
                        isSelected={note._id === selectedNoteId}
                        onClick={() => setSelectedNoteId(note._id)}
                        onContentEditingChange={(id, isEditing) => {
                          if (isEditing) setEditingNoteId(id);
                          else setEditingNoteId((cur) => (cur === id ? null : cur));
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <DeleteNoteConfirmModal
                open={!!pendingDeleteNoteId}
                onCancel={() => setPendingDeleteNoteId(null)}
                onConfirm={async () => {
                  const id = pendingDeleteNoteId;
                  if (!id) return;
                  await deleteNote(id);
                  setPendingDeleteNoteId(null);
                }}
              />

              <RelatedNotesDrawer
                isOpen={!!selectedNoteId}
                onClose={() => setSelectedNoteId(null)}
                selectedNoteId={selectedNoteId}
                allNotes={notes}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<div>Loading notes...</div>}>
      <NotesContent />
    </Suspense>
  );
}

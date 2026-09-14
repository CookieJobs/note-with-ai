'use client';

import { useEffect, useState, Suspense, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import TopNavigation from '../../components/TopNavigation';
import { Button } from '../../components/ui/button';
import { authFetch, getUser, isAuthenticated } from '../../utils/auth';

import DeleteNoteConfirmModal from './components/DeleteNoteConfirmModal';
import ModernNoteCard from './components/ModernNoteCard';
import FloatingQuickCompose from './components/FloatingQuickCompose';
import RelatedNotesDrawer from './components/RelatedNotesDrawer';
import NoteCounter from './components/NoteCounter';
import { preloadRichTextEditorFromIntent } from './components/richTextEditorLoader';
import { useAuthGuard } from './hooks/useAuthGuard';
import { useCreateNote } from './hooks/useCreateNote';
import { useNotes, type Note } from './hooks/useNotes';
import { NOTE_EDITOR_INSIDE_SELECTOR } from './utils/editorInside';
import layoutStyles from './styles/layout.module.scss';
import cardStyles from './styles/note-card.module.scss';
import composeStyles from './styles/floating-compose.module.scss';

const styles = {
  ...layoutStyles,
  ...cardStyles,
  ...composeStyles,
};

type ActiveEditorState =
  | { type: 'none' }
  | { type: 'compose' }
  | { type: 'note'; noteId: string };

const INITIAL_NOTE_ENTRANCE_LIMIT = 8;

// 是 Next.js App Router 的一个“路由段配置”，用来告诉 Next.js：
// 这个页面要强制走动态渲染（不要被静态生成/缓存成固定 HTML）
export const dynamic = 'force-dynamic';

function NotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  
  // 删除确认弹窗
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  const pendingDeleteOpenerRef = useRef<HTMLElement | null>(null);
  // 页面层统一维护当前活跃编辑壳层
  const [activeEditor, setActiveEditor] = useState<ActiveEditorState>({ type: 'none' });
  const prefersReducedMotion = useReducedMotion();
  const hasPreloadedEditor = useRef(false);

  const preloadEditorFromIntent = useCallback(() => {
    if (hasPreloadedEditor.current) return;
    hasPreloadedEditor.current = true;
    void preloadRichTextEditorFromIntent();
  }, []);

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
    isLoading,
    deleteNote,
    createNote,
    updateNote,
    refreshRecommendCache,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    loadMore,
  } = useNotes(user, { onError: setError });

  // 新建笔记 Hook
  const {
    newContentText,
    newContentJson,
    changeContent,
    discardDraft,
    loading: createLoading,
    saveState,
    localDraftState,
    draftRestored,
    savedNote,
    saveError,
    handleSubmit,
  } = useCreateNote(createNote, { userId: user?.id });

  const latestSavedNote = notes.find(note => note._id === savedNote?._id) ?? savedNote;
  const localDraftMessage = localDraftState === 'unavailable'
    ? '无法读取或保留本机草稿，离开前请保存到云端。'
    : newContentText.trim() ? '草稿已保留在本机，尚未保存到云端。' : '';
  const captureStatus = saveError
    ? `${saveError} ${newContentText.trim() ? localDraftMessage : ''}`
    : saveState === 'saving' ? `正在保存到云端… ${localDraftMessage}`
    : saveState === 'saved' && newContentText.trim() ? `提交时的内容已保存，当前更改尚未保存到云端。${localDraftState === 'unavailable' ? localDraftMessage : '草稿已保留在本机。'}`
    : saveState === 'saved' ? `已保存到云端。${latestSavedNote?.enrichment?.status === 'pending' ? 'AI 正在后台理解这条记录，你可以继续记录。' : latestSavedNote?.enrichment?.status === 'degraded' ? 'AI 处理暂未完成，不影响笔记保存。' : ''}`
    : draftRestored ? '已恢复本机草稿，可以继续编辑。'
    : localDraftMessage;

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
  const [highlightedNote, setHighlightedNote] = useState<Note | null>(null);
  const visibleNotes = useMemo(() => (
    highlightedNote && !notes.some((note) => note._id === highlightedNote._id)
      ? [highlightedNote, ...notes]
      : notes
  ), [highlightedNote, notes]);
  const selectedNote = selectedNoteId ? visibleNotes.find((note) => note._id === selectedNoteId) ?? null : null;
  const [drafts, setDrafts] = useState<Record<string, { json: JSONContent; text: string; dirty: boolean }>>({});
  const editingNoteId = activeEditor.type === 'note' ? activeEditor.noteId : null;
  const isComposeOpen = activeEditor.type === 'compose';
  
  // 用于存储笔记 DOM 节点的引用，实现自动滚动
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // 滚动容器引用
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlightId || notes.some((note) => note._id === highlightId)) {
      setHighlightedNote(null);
      return;
    }

    const controller = new AbortController();
    void authFetch(`/api/notes/${encodeURIComponent(highlightId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`请求失败: ${response.status}`);
        const payload: unknown = await response.json();
        const note = payload && typeof payload === 'object'
          && 'success' in payload && (payload as { success?: unknown }).success === true
          && 'data' in payload && (payload as { data?: { note?: unknown } }).data?.note;
        if (!note || typeof note !== 'object' || (note as { _id?: unknown })._id !== highlightId) {
          throw new Error('笔记详情响应无效');
        }
        if (!controller.signal.aborted) setHighlightedNote(note as Note);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHighlightedNote(null);
      });

    return () => controller.abort();
  }, [highlightId, notes]);

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
  }, [highlightId, visibleNotes]);

  const handleDraftChange = (id: string, draft: { json: JSONContent; text: string; dirty: boolean }) => {
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

  const closeActiveEditor = useCallback(() => {
    setActiveEditor({ type: 'none' });
  }, []);

  const openCompose = useCallback(() => {
    preloadEditorFromIntent();
    setActiveEditor({ type: 'compose' });
  }, [preloadEditorFromIntent]);

  const handleComposeDiscard = useCallback(() => {
    if (discardDraft()) setActiveEditor({ type: 'none' });
  }, [discardDraft]);

  const handleComposeSubmit = useCallback(async () => {
    if (await handleSubmit()) {
      setActiveEditor(current => current.type === 'compose' ? { type: 'none' } : current);
    }
  }, [handleSubmit]);

  const handleContentEditingChange = useCallback((id: string, isEditing: boolean) => {
    if (isEditing) {
      preloadEditorFromIntent();
      setActiveEditor((current) => (
        current.type === 'note' && current.noteId === id
          ? current
          : { type: 'note', noteId: id }
      ));
      return;
    }

    setActiveEditor((current) => (
      current.type === 'note' && current.noteId === id
        ? { type: 'none' }
        : current
    ));
  }, [preloadEditorFromIntent]);

  const preloadEditorBeforeCardEdit = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (target?.closest(`.${styles.noteTextWrapper}`)) preloadEditorFromIntent();
  }, [preloadEditorFromIntent]);

  const handleCaptureKeyboardIntent = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') preloadEditorFromIntent();
  }, [preloadEditorFromIntent]);

  // 详情浮层关闭逻辑
  useEffect(() => {
    if (activeEditor.type === 'none') return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;

      if (t.closest(`.${styles.noteCardEditing}`)) return;
      if (t.closest(`.${styles.floatingComposeShell}`)) return;
      if (t.closest(NOTE_EDITOR_INSIDE_SELECTOR)) return;
      if (t.closest('[data-radix-popper-content-wrapper]')) return;

      closeActiveEditor();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [activeEditor.type, closeActiveEditor]);

  return (
    <div className={`${styles.container} !bg-none !bg-gray-50`}>
      <TopNavigation />
      <main className={styles.mainContent}>
        <div className={styles.contentWrapper}>
          {error && (
            <div className={styles.errorBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 9v4m0 4h.01M10.29 3.86l-7.5 12.99A1 1 0 003.62 18h16.76a1 1 0 00-.86-1.5l-7.5-12.99a1 1 0 00-1.72 0z" stroke="var(--color-action-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                <div
                  className={styles.feedComposeAnchor}
                  onPointerEnter={preloadEditorFromIntent}
                  onFocus={preloadEditorFromIntent}
                  onTouchStart={preloadEditorFromIntent}
                  onKeyDown={handleCaptureKeyboardIntent}
                >
                  <FloatingQuickCompose
                    key={user?.id ?? 'anonymous'}
                    open={isComposeOpen}
                    valueJson={newContentJson ?? buildJsonFromPlain(newContentText)}
                    valueText={newContentText}
                    onOpen={openCompose}
                    onChange={changeContent}
                    onSubmit={handleComposeSubmit}
                    onClose={closeActiveEditor}
                    onDiscard={handleComposeDiscard}
                    loading={createLoading}
                    saveFailed={saveState === 'failed'}
                    status={captureStatus}
                    statusIsError={Boolean(saveError) || localDraftState === 'unavailable'}
                  />
                </div>
                <div
                  className={styles.feedList}
                  onPointerDownCapture={preloadEditorBeforeCardEdit}
                  onFocusCapture={preloadEditorBeforeCardEdit}
                  onKeyDownCapture={handleCaptureKeyboardIntent}
                >
                  <NoteCounter count={notes.length} />

                  <AnimatePresence>
                    {visibleNotes.map((note, index) => {
                      const shouldAnimate = !prefersReducedMotion && index < INITIAL_NOTE_ENTRANCE_LIMIT;
                      const listMotion = shouldAnimate ? 'enter' : 'none';

                      return (
                        <motion.div
                          key={note._id}
                          className={shouldAnimate ? styles.noteListAnimatedCard : undefined}
                          data-note-list-motion={listMotion}
                          initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
                          animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
                          exit={shouldAnimate ? { opacity: 0, y: -8 } : undefined}
                          transition={shouldAnimate ? { duration: 0.16, ease: 'easeOut' } : { duration: 0 }}
                          ref={el => { noteRefs.current[note._id] = el; }}
                        >
                          <ModernNoteCard
                            note={note}
                            onRequestDelete={(id, openerRef) => {
                              pendingDeleteOpenerRef.current = openerRef?.current ?? null;
                              setPendingDeleteNoteId(id);
                            }}
                            updateNote={updateNote}
                            draft={drafts[note._id]}
                            onDraftChange={handleDraftChange}
                            isContentEditingActive={editingNoteId === note._id}
                            isHighlighted={note._id === highlightId}
                            isSelected={note._id === selectedNoteId}
                            onOpenRelated={(id) => setSelectedNoteId(id)}
                            onContentEditingChange={handleContentEditingChange}
                          />
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  <div className="flex flex-col items-center gap-2 py-4">
                    {hasNextPage ? (
                      <>
                        {isFetchNextPageError && (
                          <p id="load-more-error" role="alert" className="text-sm [color:var(--color-status-error)]">
                            加载更多笔记失败，请重试。
                          </p>
                        )}
                        <Button
                          type="button"
                          className="min-h-11 min-w-11 px-4"
                          disabled={isFetchingNextPage}
                          aria-describedby={isFetchNextPageError ? 'load-more-error' : undefined}
                          onClick={() => { void loadMore(); }}
                        >
                          {isFetchingNextPage ? '正在加载更多笔记…' : '加载更多笔记'}
                        </Button>
                      </>
                    ) : (
                      <p aria-live="polite" className="text-sm [color:var(--color-text-secondary)]">已加载全部笔记</p>
                    )}
                  </div>
                </div>
              </div>

              <DeleteNoteConfirmModal
                open={!!pendingDeleteNoteId}
                openerRef={pendingDeleteOpenerRef}
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
                selectedNote={selectedNote}
                onRefreshRecommendCache={refreshRecommendCache}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

import type { JSONContent } from '@tiptap/react';

export default function NotesPage() {
  return (
    <Suspense fallback={<div>Loading notes...</div>}>
      <NotesContent />
    </Suspense>
  );
}

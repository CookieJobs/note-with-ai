'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import TopNavigation from '../../components/TopNavigation';
import RelatedNoteCard from '../../components/RelatedNoteCard';
import { getUser, isAuthenticated } from '../../utils/auth';

import DeleteNoteConfirmModal from './components/DeleteNoteConfirmModal';
import ModernNoteCard from './components/ModernNoteCard';
import { useAuthGuard } from './hooks/useAuthGuard';
import { useComposeActionsA11y } from './hooks/useComposeActionsA11y';
import { useComposeCollapse } from './hooks/useComposeCollapse';
import { useCreateNote } from './hooks/useCreateNote';
import { useNotes } from './hooks/useNotes';
import styles from './notes.module.scss';

// 是 Next.js App Router 的一个“路由段配置”，用来告诉 Next.js：
// 这个页面要强制走动态渲染（不要被静态生成/缓存成固定 HTML）
export const dynamic = 'force-dynamic';

function NotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 新增：compose 区域容器与操作区 refs + 隐藏定时器
  const composeContainerRef = useRef<HTMLDivElement | null>(null);
  const composeActionsRef = useRef<HTMLDivElement | null>(null);
  // 新增：滚动容器 ref 与收缩状态
  const notesScrollRef = useRef<HTMLDivElement | null>(null);
  
  // 删除确认弹窗：提升到页面级，避免被单条卡片的 transform/overflow 影响层级
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  // 历史正文编辑态：用于强制收缩“快速记录”（不锁列表滚动）
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // 鉴权守卫：未登录自动跳转到 /auth
  const user = useAuthGuard({
    isAuthenticated,
    getUser,
    routerPush: router.push,
    redirectTo: '/auth',
  });

  // 数据逻辑抽成 Hook：加载列表/删除/更新字段都在这里
  const {
    notes,
    setNotes,
    deleteNote,
    updateTitle: handleUpdateTitle,
    updateContent: handleUpdateContent,
    updateKeywords: handleUpdateKeywords,
  } = useNotes(user, { onError: setError });

  // 新建笔记（快速记录）逻辑抽成 Hook
  const {
    newContent,
    setNewContent,
    loading,
    isComposing,
    setIsComposing,
    handleSubmit,
    handleKeyDown,
    activeRelatedNoteId,
    relatedNotes,
    relatedLoading,
    noRelatedFound,
  } = useCreateNote(setNotes, { onError: setError, textareaRef });

  // 滚动控制“快速记录”收缩态；编辑历史正文时强制收缩
  const { composeCollapsed, setComposeCollapsed } = useComposeCollapse(notesScrollRef, isComposing, 80, !!editingNoteId);

  // compose actions 的可访问性与防闪烁（focus/blur capture）
  const { handleComposeFocusCapture, handleComposeBlurCapture } = useComposeActionsA11y({
    composeContainerRef,
    composeActionsRef,
    onExitComposing: () => setIsComposing(false),
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!composeCollapsed) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    } else {
      el.style.height = '';
    }
  }, [newContent, composeCollapsed]);

  const highlightId = searchParams.get('highlight') || '';
  const highlightedRef = useRef<HTMLDivElement | null>(null);

  // 首次加载后滚动并高亮
  useEffect(() => {
    if (!highlightId || notes.length === 0) return;
    // 延迟到列表渲染完成
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
      // 临时添加动画类，3秒后移除高亮（通过 CSS 动画淡出）
      if (el) {
        el.classList.add(styles.noteCardHighlight);
        setTimeout(() => {
          el && el.classList.remove(styles.noteCardHighlight);
        }, 3000);
      }
    }
  };

  return (
    <div className={styles.container}>
      <TopNavigation />
      <main className={styles.mainContent}>
        <div className={styles.contentWrapper}>
          {/* 错误提示 */}
          {error && (
            <div className={styles.errorBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 9v4m0 4h.01M10.29 3.86l-7.5 12.99A1 1 0 003.62 18h16.76a1 1 0 00.86-1.5l-7.5-12.99a1 1 0 00-1.72 0z" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* 写作输入区域（恢复） */}
          <div
            ref={composeContainerRef}
            className={`${styles.composeArea} ${isComposing ? styles.composing : ''} ${composeCollapsed ? styles.composeAreaCollapsed : ''}`}
            onFocusCapture={handleComposeFocusCapture}
            onBlurCapture={handleComposeBlurCapture}
          >
            <div className={styles.composeHeader}>
              <div className={styles.composeIcon}>📝</div>
              <div className={styles.composeTitle}>快速记录</div>
            </div>
            <textarea
              ref={textareaRef}
              className={styles.composeInput}
              placeholder="此刻的想法、待办或总结... 支持 Cmd/Ctrl + Enter 快速保存"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onFocus={() => { setIsComposing(true); setComposeCollapsed(false); }}
              onKeyDown={handleKeyDown}
              rows={composeCollapsed ? 1 : 3}
              disabled={loading}
            />
            <div className={styles.composeActions} ref={composeActionsRef} aria-hidden="true">
              <div className={styles.composeHint}>
                <span>按</span>
                <kbd>Cmd</kbd>
                <span>/</span>
                <kbd>Ctrl</kbd>
                <span> + </span>
                <kbd>Enter</kbd>
                <span> 快速保存</span>
              </div>
              <div className={styles.composeButtons}>
                {isComposing && (
                  <button
                    className={styles.cancelButton}
                        onClick={() => { setIsComposing(false); setNewContent(''); notesScrollRef.current?.scrollTop; }}
                    disabled={loading}
                  >
                    取消
                  </button>
                )}
                <button
                  className={styles.submitButton}
                  onClick={handleSubmit}
                  disabled={loading || newContent.trim().length === 0}
                >
                  {loading ? (
                    <span className={styles.buttonSpinner} />
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      保存
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className={styles.notesContainer}>
            <div className={styles.notesScrollContainer} ref={notesScrollRef}>
              <div className={styles.notesList}>
                {notes.map((note) => (
                  <div key={note._id} id={`note-${note._id}`} className={styles.noteItemWrapper}>
                    <ModernNoteCard
                      note={note}
                      onRequestDelete={setPendingDeleteNoteId}
                      onUpdateTitle={handleUpdateTitle}
                      onUpdateContent={handleUpdateContent}
                      onUpdateKeywords={handleUpdateKeywords}
                      isHighlighted={!!highlightId && note._id === highlightId}
                      cardRef={attachRefIfHighlighted(note._id)}
                      onContentEditingChange={(id, isEditing) => {
                        if (isEditing) setEditingNoteId(id);
                        else setEditingNoteId((cur) => (cur === id ? null : cur));
                      }}
                    />
                    {note._id === activeRelatedNoteId && (relatedNotes.length > 0 || relatedLoading || noRelatedFound) && (
                      <div className={styles.relatedNotesSection}>
                        <div className={styles.relatedHeader}>
                          <span className={styles.relatedIcon}>🔗</span>
                          <span className={styles.relatedTitle}>相关笔记</span>
                          {relatedLoading && <span className={styles.relatedLoading}>查找中...</span>}
                        </div>
                        <div className={styles.relatedList}>
                          {!relatedLoading && relatedNotes.length > 0 && relatedNotes.map(rn => (
                            <RelatedNoteCard 
                              key={rn._id} 
                              note={rn} 
                              onExpand={(id) => {
                                const el = document.getElementById(`note-${id}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  // 添加高亮动画
                                  el.classList.add(styles.noteCardHighlight);
                                  setTimeout(() => el.classList.remove(styles.noteCardHighlight), 2000);
                                }
                              }}
                            />
                          ))}
                          {!relatedLoading && noRelatedFound && (
                            <div className={styles.emptyRelated}>
                              未找到相关笔记
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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

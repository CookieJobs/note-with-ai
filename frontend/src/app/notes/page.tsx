'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import TopNavigation from '../../components/TopNavigation';
import RelatedNoteCard from '../../components/RelatedNoteCard';
import { getUser, isAuthenticated } from '../../utils/auth';

import DeleteNoteConfirmModal from './components/DeleteNoteConfirmModal';
import ModernNoteCard from './components/ModernNoteCard';
import FloatingQuickCompose from './components/FloatingQuickCompose';
import { useAuthGuard } from './hooks/useAuthGuard';
import { useCreateNote } from './hooks/useCreateNote';
import { useNotes } from './hooks/useNotes';
import styles from './notes.module.scss';

// 是 Next.js App Router 的一个“路由段配置”，用来告诉 Next.js：
// 这个页面要强制走动态渲染（不要被静态生成/缓存成固定 HTML）
export const dynamic = 'force-dynamic';

function NotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 临时：隐藏页面内的“快速记录”块，只保留底部悬浮版本
  const showInlineCompose = false;
  const [error, setError] = useState('');
  // 预留：移动端菜单（当前未用到）
  // const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  
  // 删除确认弹窗：提升到页面级，避免被单条卡片的 transform/overflow 影响层级
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  // 历史正文编辑态：用于强制收缩“快速记录”（不锁列表滚动）
  // 预留：正文编辑态（当前仅用于后续可能的“锁定右侧/收起浮层”等交互）
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
      newContentText,
      setNewContentText,
      newContentJson,
      setNewContentJson,
    loading,
    isComposing,
    setIsComposing,
    handleSubmit,
    activeRelatedNoteId,
    relatedNotes,
    relatedLoading,
    noRelatedFound,
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
  const highlightedRef = useRef<HTMLDivElement | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // highlight 参数：优先选中并滚动到左侧列表项
  useEffect(() => {
    if (!highlightId) return;
    setSelectedNoteId(highlightId);
  }, [highlightId]);

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
        el.classList.add(styles.historyItemHighlight);
        setTimeout(() => {
          el && el.classList.remove(styles.historyItemHighlight);
        }, 3000);
      }
    }
  };

  const selectedNote = selectedNoteId ? notes.find((n) => n._id === selectedNoteId) : null;

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

          {/* 写作输入区域（目前隐藏：保留底部悬浮快速记录） */}
          {showInlineCompose && null}

          {/* 聊天式双栏：左侧历史列表（紧凑可滚动） + 右侧工作台编辑区（默认空） */}
          <div className={styles.splitLayout}>
            <aside className={styles.historyPane} aria-label="历史笔记列表">
              <div className={styles.historyPaneHeader}>
                <div className={styles.historyPaneTitle}>历史笔记</div>
                <div className={styles.historyPaneCount}>{notes.length}</div>
              </div>

              <div className={styles.historyScroll} ref={historyScrollRef}>
                {notes.map((note) => {
                  const isSelected = selectedNoteId === note._id;
                  const title = (note.title || '').trim() || '未命名';
                  const preview = (note.contentText || note.content || '').trim().replace(/\s+/g, ' ').slice(0, 56);

                  return (
                    <div
                      key={note._id}
                      id={`history-${note._id}`}
                      ref={attachRefIfHighlighted(note._id)}
                      className={`${styles.historyItem} ${isSelected ? styles.historyItemSelected : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedNoteId((cur) => {
                          const next = cur === note._id ? null : note._id;
                          if (next === null) setEditingNoteId(null);
                          return next;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setSelectedNoteId((cur) => {
                            const next = cur === note._id ? null : note._id;
                            if (next === null) setEditingNoteId(null);
                            return next;
                          });
                        }
                      }}
                      title={title}
          >
                      <div className={styles.historyItemTitleRow}>
                        <div className={styles.historyItemTitle}>{title}</div>
                        {note.enriching && <div className={styles.historyItemDot} title="AI 处理中" />}
            </div>
                      <div className={styles.historyItemPreview}>{preview || '（空）'}</div>
              </div>
                  );
                })}
              </div>
            </aside>

            <section className={styles.detailSlot} aria-label="笔记工作台">
              {!selectedNote ? null : (
                <>
                    <ModernNoteCard
                    note={selectedNote}
                    onRequestDelete={(id) => {
                      setPendingDeleteNoteId(id);
                    }}
                      onUpdateTitle={handleUpdateTitle}
                      onUpdateContent={handleUpdateContent}
                      onUpdateKeywords={handleUpdateKeywords}
                    isHighlighted={false}
                    layoutVariant="detail"
                    onContentEditingChange={(id, isEditing) => {
                      if (isEditing) setEditingNoteId(id);
                      else setEditingNoteId((cur) => (cur === id ? null : cur));
                    }}
                    />

                  {selectedNote._id === activeRelatedNoteId &&
                    (relatedNotes.length > 0 || relatedLoading || noRelatedFound) && (
                      <div className={styles.relatedNotesSection}>
                        <div className={styles.relatedHeader}>
                          <span className={styles.relatedIcon}>🔗</span>
                          <span className={styles.relatedTitle}>相关笔记</span>
                          {relatedLoading && <span className={styles.relatedLoading}>查找中...</span>}
                        </div>
                        <div className={styles.relatedList}>
                          {!relatedLoading &&
                            relatedNotes.length > 0 &&
                            relatedNotes.map((rn) => (
                            <RelatedNoteCard 
                              key={rn._id} 
                              note={rn} 
                              onExpand={(id) => {
                                  setSelectedNoteId(id);
                                  // 选中后滚动到对应左侧项
                                  const el = document.getElementById(`history-${id}`);
                                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }}
                            />
                          ))}
                          {!relatedLoading && noRelatedFound && (
                            <div className={styles.emptyRelated}>未找到相关笔记</div>
                          )}
                        </div>
                      </div>
                    )}
                </>
              )}
            </section>
                  </div>

          <DeleteNoteConfirmModal
            open={!!pendingDeleteNoteId}
            onCancel={() => setPendingDeleteNoteId(null)}
            onConfirm={async () => {
              const id = pendingDeleteNoteId;
              if (!id) return;
              await deleteNote(id);
              setPendingDeleteNoteId(null);
              setSelectedNoteId((cur) => (cur === id ? null : cur));
            }}
          />

                {/* 底部悬浮快速记录 */}
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
                  loading={loading}
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

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import TopNavigation from '../../../components/TopNavigation';
import RelatedNoteCard from '../../../components/RelatedNoteCard';
import { getUser, isAuthenticated } from '../../../utils/auth';

import DeleteNoteConfirmModal from '../components/DeleteNoteConfirmModal';
import ModernNoteCard from '../components/ModernNoteCard';
import FloatingQuickCompose from '../components/FloatingQuickCompose';
import WorkspaceGrid from '../components/WorkspaceGrid';
import HistoryPane from '../components/HistoryPane';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { useCreateNote } from '../hooks/useCreateNote';
import { useNotes } from '../hooks/useNotes';
import styles from '../notes.module.scss';
import { notFound } from 'next/navigation';

// 是 Next.js App Router 的一个“路由段配置”，用来告诉 Next.js：
// 这个页面要强制走动态渲染（不要被静态生成/缓存成固定 HTML）
export const dynamic = 'force-dynamic';

function NotesViewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 临时：隐藏页面内的“快速记录”块，只保留底部悬浮版本
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
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [historyColorMap, setHistoryColorMap] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, { json: any; text: string; dirty: boolean }>>({});
  const [exitEditSignal, setExitEditSignal] = useState(0);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const hasAnyDraft = Object.values(drafts).some((d) => d?.dirty);

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
    if (!selectedNoteId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (editingNoteId) return;

      const t = e.target as Element | null;
      if (!t) return;

      if (t.closest(`.${styles.workspaceOverlayPanel}`)) return;
      if (t.closest(`.${styles.floatingCompose}`)) return;
      if (t.closest(`.${styles.historyItem}`)) return;
      if (t.closest(`.${styles.workspaceCell}`)) return;
      if (t.closest(`.${styles.workspaceRecommendDock}`)) return;

      setSelectedNoteId(null);
      setEditingNoteId(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [selectedNoteId, editingNoteId]);

  // Highlight 逻辑
  useEffect(() => {
    if (!highlightId) return;
    setSelectedNoteId(highlightId);
  }, [highlightId]);

  const selectedNote = selectedNoteId ? notes.find((n) => n._id === selectedNoteId) : null;

  return (
    <div className={`${styles.container} ${historyCollapsed ? styles.containerOverflowVisible : ''}`}>
      <TopNavigation />
      <main className={`${styles.mainContent} ${historyCollapsed ? `${styles.mainContentOverflowVisible} ${styles.mainContentCollapsed}` : ''}`}>
        <div className={styles.contentWrapper}>
          {error && (
            <div className={styles.errorBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 9v4m0 4h.01M10.29 3.86l-7.5 12.99A1 1 0 003.62 18h16.76a1 1 0 00.86-1.5l-7.5-12.99a1 1 0 00-1.72 0z" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {isLoading && notes.length === 0 ? (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '100%', 
              color: '#888',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div className="loading-spinner" style={{
                width: '24px',
                height: '24px',
                border: '3px solid rgba(0,0,0,0.1)',
                borderTopColor: '#333',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <style jsx>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
              <span>正在加载笔记...</span>
            </div>
          ) : (
            <>
              {/* 聊天式双栏 */}
              <div className={`${styles.splitLayout} ${historyCollapsed ? styles.splitLayoutCollapsed : ''}`}>
                <HistoryPane
                  notes={notes}
                  selectedNoteId={selectedNoteId}
                  hoveredNoteId={hoveredNoteId}
                  onSelectNote={(id) => {
                    setSelectedNoteId((cur) => {
                      const next = cur === id ? null : id;
                      if (next === null) setEditingNoteId(null);
                      return next;
                    });
                  }}
                  onHoverNote={setHoveredNoteId}
                  drafts={drafts}
                  historyColorMap={historyColorMap}
                  historyCollapsed={historyCollapsed}
                  highlightId={highlightId}
                />

                <section className={styles.detailSlot} aria-label="笔记工作台">
                  <div className={styles.workspacePane}>
                    <WorkspaceGrid
                      notes={notes}
                      selectedNoteId={selectedNoteId}
                      hoveredNoteId={hoveredNoteId}
                      onSelect={(id) => {
                        setSelectedNoteId(id);
                        const el = document.getElementById(`history-${id}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }}
                      onHover={(id) => setHoveredNoteId(id)}
                      onColorMapChange={setHistoryColorMap}
                    />

                    {selectedNote && (
                      <div className={styles.workspaceOverlay}>
                        <button
                          type="button"
                          className={styles.workspaceOverlayBackdrop}
                          aria-label="关闭详情"
                          onClick={() => {
                            if (editingNoteId) {
                              setExitEditSignal((v) => v + 1);
                              setEditingNoteId(null);
                              return;
                            }
                            setSelectedNoteId(null);
                          }}
                        />
                        <div
                          className={`${styles.workspaceOverlayPanel} dark`}
                          onPointerDownCapture={(e) => {
                            if (!editingNoteId) return;
                            const t = e.target as Element | null;
                            if (!t) return;
                            if (
                              t.closest(`.${styles.noteContentInput}`) ||
                              t.closest(`.${styles.richToolbar}`) ||
                              t.closest(`.${styles.noteEditActions}`)
                            ) {
                              return;
                            }
                            setExitEditSignal((v) => v + 1);
                            setEditingNoteId(null);
                          }}
                        >
                          <ModernNoteCard
                            key={selectedNote._id}
                            note={selectedNote}
                            onRequestDelete={(id) => {
                              setPendingDeleteNoteId(id);
                            }}
                            onUpdateTitle={handleUpdateTitle}
                            onUpdateContent={handleUpdateContent}
                            onUpdateKeywords={handleUpdateKeywords}
                            draft={drafts[selectedNote._id]}
                            onDraftChange={handleDraftChange}
                            exitEditSignal={exitEditSignal}
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
                        </div>
                      </div>
                    )}
                  </div>
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

              <FloatingQuickCompose
                valueJson={newContentJson ?? buildJsonFromPlain(newContentText)}
                valueText={newContentText}
                allNotes={notes}
                onSelectNote={(id) => {
                  setSelectedNoteId(id);
                  const el = document.getElementById(`history-${id}`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
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
              <button
                type="button"
                className={`${styles.historyCollapseToggle} ${historyCollapsed ? styles.historyCollapseToggleCollapsed : ''}`}
                onClick={() => setHistoryCollapsed((v) => !v)}
                aria-label={historyCollapsed ? '展开历史栏' : '收起历史栏'}
                title={historyCollapsed ? '展开历史栏' : '收起历史栏'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function NotesViewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  return (
    <Suspense fallback={<div>Loading notes...</div>}>
      <NotesViewContent />
    </Suspense>
  );
}

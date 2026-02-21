'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import TopNavigation from '../../components/TopNavigation';
import RelatedNoteCard from '../../components/RelatedNoteCard';
import { getUser, isAuthenticated } from '../../utils/auth';

import DeleteNoteConfirmModal from './components/DeleteNoteConfirmModal';
import ModernNoteCard from './components/ModernNoteCard';
import FloatingQuickCompose from './components/FloatingQuickCompose';
import WorkspaceGrid from './components/WorkspaceGrid';
import { useAuthGuard } from './hooks/useAuthGuard';
import { useCreateNote } from './hooks/useCreateNote';
import { useElasticScroll } from './hooks/useElasticScroll';
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
  
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const historyPaneRef = useRef<HTMLDivElement | null>(null);
  const [collapsedLabel, setCollapsedLabel] = useState<{ noteId: string; title: string; top: number } | null>(null);

  const historyBounceLockRef = useElasticScroll(historyScrollRef);

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
  const highlightedRef = useRef<HTMLDivElement | null>(null);
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
    if (!highlightId) return;
    setSelectedNoteId(highlightId);
  }, [highlightId]);

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

  const selectedNote = selectedNoteId ? notes.find((n) => n._id === selectedNoteId) : null;

  // 自动滚动到选中项
  useEffect(() => {
    if (!selectedNoteId) return;
    const el = document.getElementById(`history-${selectedNoteId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedNoteId]);

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
                          className={`${styles.historyItem} ${isSelected ? styles.historyItemSelected : ''} ${hoveredNoteId === note._id ? styles.historyItemHovered : ''}`}
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
                            setHoveredNoteId(note._id);
                          }}
                          onMouseLeave={() => {
                            if (historyBounceLockRef.current) return;
                            setHoveredNoteId((cur) => (cur === note._id ? null : cur));
                          }}
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

export default function NotesPage() {
  return (
    <Suspense fallback={<div>Loading notes...</div>}>
      <NotesContent />
    </Suspense>
  );
}

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
  const historyPaneRef = useRef<HTMLDivElement | null>(null);
  const [collapsedLabel, setCollapsedLabel] = useState<{ noteId: string; title: string; top: number } | null>(null);
  const historyBounceLockRef = useRef(false);
  
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

  // 详情浮层：点击“外部”关闭（但不要影响：快速记录、点击历史条目切换、点击方块切换）
  useEffect(() => {
    if (!selectedNoteId) return;
    const onPointerDown = (e: PointerEvent) => {
      // 编辑态防误触：避免丢失输入
      if (editingNoteId) return;

      const t = e.target as Element | null;
      if (!t) return;

      // 点在详情卡片内部：不关闭
      if (t.closest(`.${styles.workspaceOverlayPanel}`)) return;
      // 点在快速记录内部：不关闭（且允许继续交互）
      if (t.closest(`.${styles.floatingCompose}`)) return;
      // 点在历史条目：交给 onClick 切换选中，不在这里关闭
      if (t.closest(`.${styles.historyItem}`)) return;
      // 点在工作区方块：交给 onSelect 切换选中，不在这里关闭
      if (t.closest(`.${styles.workspaceCell}`)) return;
      // 点在联想面板（包含卡片）：不关闭
      if (t.closest(`.${styles.workspaceRecommendDock}`)) return;

      setSelectedNoteId(null);
      setEditingNoteId(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [selectedNoteId, editingNoteId]);

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

    // 兜底：DOM 还没渲染到对应条目时，用索引估算位置（收缩态固定高度）
    // historyScroll: padding-top 8px; gap 8px; item height 30px
    if (pr && noteIdx >= 0) {
      const top = 8 + noteIdx * (30 + 8) + 30 / 2;
      setCollapsedLabel({ noteId: targetId, title, top });
      return;
    }

    setCollapsedLabel(null);
  }, [historyCollapsed, hoveredNoteId, selectedNoteId, notes]);

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

  // 历史列表“回弹”：顶部/底部拉伸后弹回
  useEffect(() => {
    const el = historyScrollRef.current;
    if (!el) return;
    let offset = 0;
    let rafId: number | null = null;
    let bounceTimer: number | null = null;
    const applyTransform = () => {
      el.style.transform = Math.abs(offset) > 0.5 ? `translateY(${offset}px)` : '';
    };

    const release = () => {
      if (rafId) cancelAnimationFrame(rafId);
      const from = offset;
      const start = performance.now();
      const dur = 220;
      const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        offset = from * (1 - easeOut(p));
        applyTransform();
        if (p < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          offset = 0;
          applyTransform();
          rafId = null;
          historyBounceLockRef.current = false;
        }
      };
      rafId = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const nextScroll = el.scrollTop + e.deltaY;
      const overscrollTop = nextScroll < 0;
      const overscrollBottom = nextScroll > maxScroll;
      if (overscrollTop || overscrollBottom) {
        e.preventDefault();
        const dir = overscrollBottom ? -1 : 1;
        const next = offset + Math.abs(e.deltaY) * 0.08 * dir;
        offset = Math.max(-18, Math.min(18, next));
        applyTransform();
        historyBounceLockRef.current = true;
        if (bounceTimer) window.clearTimeout(bounceTimer);
        bounceTimer = window.setTimeout(() => release(), 50);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (rafId) cancelAnimationFrame(rafId);
      if (bounceTimer) window.clearTimeout(bounceTimer);
      el.style.transform = '';
      historyBounceLockRef.current = false;
    };
  }, []);

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

  // 选择变化时：左侧历史列表自动滚动到对应项（无论来自方块/联想/列表）
  useEffect(() => {
    if (!selectedNoteId) return;
    const el = document.getElementById(`history-${selectedNoteId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedNoteId]);

  return (
    <div className={`${styles.container} ${historyCollapsed ? styles.containerOverflowVisible : ''}`}>
      <TopNavigation />
      <main
        className={`${styles.mainContent} ${historyCollapsed ? `${styles.mainContentOverflowVisible} ${styles.mainContentCollapsed}` : ''}`}
      >
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
                        // 编辑态：点击背板先退出编辑，不关闭详情
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

                {/* 底部悬浮快速记录 */}
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
                  loading={loading}
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

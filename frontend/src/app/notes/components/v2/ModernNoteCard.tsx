'use client';

import { useState, useEffect, useRef } from 'react';
import styles from '../../notes-v2.module.scss';
import TrashIcon from '../../../../components/icons/TrashIcon';
import PlusIcon from '../../../../components/icons/PlusIcon';
import type { Note } from '../../hooks/useNotes';
import RichTextEditor from '../RichTextEditor';
import RichTextViewer from '../RichTextViewer';
import { useNoteEditor } from '../../hooks/useNoteEditor';

interface NoteCardProps {
  note: Note;
  onRequestDelete: (id: string) => void;
  isHighlighted?: boolean;
  onUpdateTitle: (id: string, newTitle: string, updatedAt?: string) => void;
  onUpdateContent?: (
    id: string,
    newContent: string,
    updatedAt?: string,
    contentJson?: any,
    contentText?: string,
    embedding?: number[]
  ) => void;
  onUpdateKeywords?: (id: string, newKeywords: string[], updatedAt?: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  onContentEditingChange?: (id: string, isEditing: boolean) => void;
  draft?: { json: any; text: string; dirty: boolean };
  onDraftChange?: (id: string, draft: { json: any; text: string; dirty: boolean }) => void;
  exitEditSignal?: number;
  /** detail: 右侧工作台放大展示（默认展开、禁用“展开/收起”交互） */
  layoutVariant?: 'list' | 'detail';
  onClick?: () => void;
  isSelected?: boolean;
}

function useFocusCursorToEnd(
  isActive: boolean,
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
) {
  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      try {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      } catch {
        // ignore
      }
    });
  }, [isActive, ref]);
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const style = window.getComputedStyle(cur);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export default function ModernNoteCard({
  note,
  onRequestDelete,
  isHighlighted,
  onUpdateTitle,
  onUpdateContent,
  onUpdateKeywords,
  cardRef,
  onContentEditingChange,
  draft,
  onDraftChange,
  exitEditSignal,
  layoutVariant = 'list',
  onClick,
  isSelected,
}: NoteCardProps) {
  const {
    state,
    dispatch,
    contentJsonDraft,
    contentTextDraft,
    contentSavedFlash,
    activeKeywordIndex,
    setActiveKeywordIndex,
    tagEditValue,
    setTagEditValue,
    handleSaveTitle,
    handleSaveContent,
    handleCancelContent,
    deleteKeywordAt,
    commitKeywordAt,
    enterContentEdit,
    onEditorChange,
    getNotePlainText,
    getNoteTextForEditor,
    buildJsonFromPlain,
    extractPlainTextFromJson,
  } = useNoteEditor({
    note,
    onUpdateTitle,
    onUpdateContent,
    onUpdateKeywords,
    onContentEditingChange,
    draft,
    onDraftChange,
    exitEditSignal,
  });

  // 控制高亮动画的生命周期
  const [activeHighlight, setActiveHighlight] = useState(false);

  useEffect(() => {
    if (isHighlighted) {
      setActiveHighlight(true);
      // 动画时间是 2.4s，这里我们等待 2.4s 后自动移除高亮类，使卡片恢复正常
      const timer = setTimeout(() => {
        setActiveHighlight(false);
      }, 2400);
      return () => clearTimeout(timer);
    } else {
      setActiveHighlight(false);
    }
  }, [isHighlighted]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const contentEditActionsRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const anchorRef = useRef<'top' | 'bottom'>('top');
  const didEnterLayoutRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    
    // 计算本周一的凌晨 00:00:00
    const currentDay = now.getDay(); // 0 是周日, 1-6 是周一到周六
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    // 计算下周一的凌晨 00:00:00
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const timeStr = `${hh}:${mm}:${ss}`;
    
    if (date >= startOfWeek && date < endOfWeek) {
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      const dayStr = days[date.getDay()];
      return `本周${dayStr} ${timeStr}`;
    } else {
      const yyyy = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const dd = pad(date.getDate());
      return `${yyyy}-${month}-${dd} ${timeStr}`;
    }
  };

  // detail 模式：默认展开，且不展示“展开/收起”控件
  useEffect(() => {
    if (layoutVariant !== 'detail') return;
    if (!state.expanded) dispatch({ type: 'SET_EXPANDED', value: true });
    dispatch({ type: 'SET_CAN_EXPAND', value: false });
  }, [layoutVariant, state.expanded]);

  // 进入编辑态：自动聚焦并把光标放到末尾（标题/正文复用同一逻辑）
  useFocusCursorToEnd(state.title.isEditing, titleInputRef);

  const alignTo = (anchor: 'top' | 'bottom') => {
    const card = rootRef.current;
    if (!card) return;
    const scroller = findScrollParent(card);
    if (!scroller) return;

    const sr = scroller.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const delta = anchor === 'top' ? cr.top - sr.top : cr.bottom - sr.bottom;
    scroller.scrollTop += delta;
  };

  const applyTextareaSize = (opts: { align: boolean }) => {
    // 右侧 detail 工作台：不做“吸顶/吸底 + 强行计算高度”
    // 这里让编辑器用 CSS flex 自然铺满剩余空间，避免看起来“宽高固定”
    if (layoutVariant === 'detail') return;
    const card = rootRef.current;
    if (!card) return;
    // TipTap：操作 ProseMirror DOM（class = styles.richEditorContent）
    const el = card.querySelector(`.${styles.richEditorContent}`) as HTMLElement | null;
    if (!el) return;
    const scroller = findScrollParent(card);
    if (!scroller) return;

    const defaultMinH = 120;

    if (opts.align) alignTo(anchorRef.current);

    const sr = scroller.getBoundingClientRect();

    const prevMinH = el.style.minHeight;
    const prevH = el.style.height;
    const prevMaxH = el.style.maxHeight;
    const prevOverflowY = el.style.overflowY;
    // TipTap 的内容区是 div，不需要/不支持 resize

    // fixedH：卡片中“除 textarea 外”的固定高度
    el.style.minHeight = '0px';
    el.style.height = '0px';
    el.style.maxHeight = 'none';
    el.style.overflowY = 'hidden';
    const cardH0 = card.getBoundingClientRect().height;
    const taH0 = el.getBoundingClientRect().height;
    const fixedH = Math.max(0, cardH0 - taH0);

    // fullH：正文全部展开需要的高度
    el.style.height = 'auto';
    el.style.maxHeight = 'none';
    const fullH = (el as any).scrollHeight as number;

    // 关键约束：卡片高度不能超过滚动容器可视高度（避免被上方快速记录挡住）
    // => textarea 最大高度 = sr.height - fixedH
    const maxTaH = Math.max(0, sr.height - fixedH);
    const minTaH = Math.min(defaultMinH, maxTaH);
    const nextH = Math.max(minTaH, Math.min(fullH, maxTaH));

    el.style.maxHeight = `${maxTaH}px`;
    el.style.height = `${nextH}px`;
    el.style.overflowY = fullH > maxTaH ? 'auto' : 'hidden';

    // 恢复 min-height（默认外观仍由 CSS 控制）
    el.style.minHeight = prevMinH;

    if (opts.align) alignTo(anchorRef.current);

    // 防御：极端情况下回滚
    if (!Number.isFinite(fullH) || !Number.isFinite(fixedH)) {
      el.style.minHeight = prevMinH;
      el.style.height = prevH;
      el.style.maxHeight = prevMaxH;
      el.style.overflowY = prevOverflowY;
    }
  };

  useEffect(() => {
    if (layoutVariant === 'detail') {
      // detail 模式：清理可能残留的行内高度，交给 CSS 控制
      const card = rootRef.current;
      const el = card ? (card.querySelector(`.${styles.richEditorContent}`) as HTMLElement | null) : null;
      if (el) {
        el.style.height = '';
        el.style.maxHeight = '';
        el.style.overflowY = '';
      }
      return;
    }
    if (!state.content.isEditing) {
      didEnterLayoutRef.current = false;
      const card = rootRef.current;
      const el = card ? (card.querySelector(`.${styles.richEditorContent}`) as HTMLElement | null) : null;
      if (el) {
        el.style.height = '';
        el.style.maxHeight = '';
        el.style.overflowY = '';
      }
      return;
    }

    // 进入编辑：根据“吸顶/吸底”就近原则，先对齐，再扩展 textarea（并再次对齐）
    requestAnimationFrame(() => {
      const card = rootRef.current;
      if (!card) return;
      const scroller = findScrollParent(card);
      if (!scroller) return;
      const sr = scroller.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      const deltaTop = cr.top - sr.top;
      const deltaBottom = cr.bottom - sr.bottom;
      anchorRef.current = Math.abs(deltaTop) <= Math.abs(deltaBottom) ? 'top' : 'bottom';

      // 连续两帧执行：确保快速记录收缩导致的布局变化被吃到
      applyTextareaSize({ align: true });
      requestAnimationFrame(() => applyTextareaSize({ align: true }));
      didEnterLayoutRef.current = true;
    });
  }, [layoutVariant, state.content.isEditing]);

  useEffect(() => {
    if (layoutVariant === 'detail') return;
    if (!state.content.isEditing) return;
    if (!didEnterLayoutRef.current) return;
    // 输入/内容变化时：只更新高度与内部滚动，不再做“吸顶/吸底”对齐（避免用户滚动时被强行拉回）
    requestAnimationFrame(() => applyTextareaSize({ align: false }));
  }, [layoutVariant, state.content.value, state.content.isEditing]);

  // 仅依据“内容的总高度”和“6行高度”判断是否可展开（编辑态不展示）
  useEffect(() => {
    if (state.content.isEditing) {
      dispatch({ type: 'SET_CAN_EXPAND', value: false });
      return;
    }

    const el = textRef.current;
    if (!el) return;

    const computeCollapsedH = () => {
      const computed = window.getComputedStyle(el);
      const lineHeightStr = computed.lineHeight;
      const lineHeight = parseFloat(lineHeightStr || '22');
      return Math.max(0, Math.round(lineHeight * 6));
    };

    const check = () => {
      const collapsedH = computeCollapsedH();
      const hasOverflow = el.scrollHeight - 1 > collapsedH;
      dispatch({ type: 'SET_CAN_EXPAND', value: hasOverflow });
    };

    check();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => check());
      ro.observe(el);
    } else {
      window.addEventListener('resize', check);
    }

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', check);
    };
  }, [note.content, state.content.isEditing]);

  // 根据 expanded 平滑过渡高度（编辑态不处理）
  useEffect(() => {
    if (state.content.isEditing) return;
    const p = textRef.current;
    if (!p) return;

    const computed = window.getComputedStyle(p);
    const lineHeightStr = computed.lineHeight;
    const lineHeight = parseFloat(lineHeightStr || '22');
    const collapsedH = Math.max(0, Math.round(lineHeight * 6));

    const update = () => {
      if (!textRef.current) return;
      if (state.expanded) {
        dispatch({ type: 'SET_MAX_HEIGHT', value: textRef.current.scrollHeight + 'px' });
      } else {
        dispatch({ type: 'SET_MAX_HEIGHT', value: collapsedH + 'px' });
      }
    };

    // 先更新一次
    update();

    // expanded=true 时：图片/富文本可能异步加载，scrollHeight 会变；需要持续修正 maxHeight
    if (!state.expanded) return;

    // 1) 下一帧再测一次（避免首帧 scrollHeight 过小）
    const raf1 = requestAnimationFrame(update);
    const raf2 = requestAnimationFrame(update);

    // 2) 监听图片 load/error
    const imgs = Array.from(p.querySelectorAll('img'));
    const onImg = () => update();
    for (const img of imgs) {
      if (!img.complete) {
        img.addEventListener('load', onImg, { once: true });
        img.addEventListener('error', onImg, { once: true });
      }
    }

    // 3) 监听 DOM 变化（例如新增图片节点），并为新图片补上 load 监听
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        update();
        const nextImgs = Array.from((textRef.current || p).querySelectorAll('img'));
        for (const img of nextImgs) {
          if (!img.complete) {
            img.addEventListener('load', onImg, { once: true });
            img.addEventListener('error', onImg, { once: true });
          }
        }
      });
      mo.observe(p, { childList: true, subtree: true });
    }

    // 4) 监听尺寸变化（文字换行/字体变化等）
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => update());
      ro.observe(p);
    }

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
    };
  }, [
    state.expanded,
    state.content.isEditing,
    // 富文本内容变化可能不体现在 note.content 上
    note.content,
    note.contentText,
    note.contentJson,
  ]);

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dispatch({ type: 'CANCEL_TITLE_EDIT', value: note.title || '' });
    }
  };

  const cardClassName = [
    styles.noteCard,
    layoutVariant === 'detail' ? styles.noteCardDetail : '',
    activeHighlight ? styles.noteCardHighlight : '',
    state.content.isEditing ? styles.noteCardEditing : '',
    // 当处于高亮状态时，移除 !bg-white 和 !shadow-none 强制覆盖，让 CSS Module 中的动画样式接管
    !activeHighlight ? '!bg-white !shadow-none' : '',
    '!border',
    isSelected ? '!border-blue-500 !ring-1 !ring-blue-500' : '!border-gray-100',
    '!rounded-xl'
  ].filter(Boolean).join(' ');
  const hasUnsavedDraft = !!draft?.dirty;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        cardRef?.(el);
      }}
      className={cardClassName}
    >
      {/* 右侧悬浮把手 */}
      <button
        className={`${styles.relatedHandle} ${isSelected ? styles.relatedHandleActive : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        title="查看相关笔记"
        aria-label="查看相关笔记"
      >
        <div className={styles.relatedHandleIcon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="15" y1="3" x2="15" y2="21"></line>
          </svg>
        </div>
      </button>

      <div
        className={styles.noteHeader}
        onClick={layoutVariant === 'detail' ? undefined : () => dispatch({ type: 'TOGGLE_EXPANDED' })}
      >
        {state.title.isEditing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <input
              autoFocus
              ref={titleInputRef}
              type="text"
              value={state.title.value}
              onChange={(e) => dispatch({ type: 'CHANGE_TITLE', value: e.target.value })}
              onKeyDown={handleTitleKeyDown}
              onBlur={() => dispatch({ type: 'CANCEL_TITLE_EDIT', value: note.title || '' })}
              className={styles.noteTitleInput}
              placeholder="添加标题..."
              maxLength={100}
            />
          </div>
        ) : (
          <div
            className={`${styles.noteTitle} !font-semibold !text-gray-900 !text-lg`}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'ENTER_TITLE_EDIT', value: note.title || '' });
            }}
          >
            {note.enriching && (!note.title || note.title.trim().length === 0) ? (
              <div className={styles.titleSkeleton} />
            ) : (
              note.title || '点击添加标题'
            )}
          </div>
        )}
        <div className={`${styles.noteActions} !gap-2`}>
          {state.title.isEditing && (
            <button
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSaveTitle();
              }}
              className={`${styles.noteEditTitleConfirm} !bg-gray-100 hover:!bg-gray-200 !text-gray-600`}
              aria-label="保存标题"
              disabled={state.title.saving}
            >
              ✓
            </button>
          )}
          <span className={`${styles.noteDate} !bg-transparent !text-gray-400 !border-none !p-0 !text-sm`}>{formatDate(note.createdAt)}</span>
          <button
            className={`${styles.deleteButton} !bg-transparent !text-gray-400 hover:!text-red-500 hover:!bg-gray-100 !rounded-md !border-none !shadow-none !p-1`}
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(note._id);
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className={styles.noteContent} ref={contentAreaRef}>
        <div
          ref={wrapperRef}
          className={state.content.isEditing ? styles.noteTextWrapperEditing : styles.noteTextWrapper}
          style={{
            maxHeight:
              state.content.isEditing
                ? undefined
                : layoutVariant === 'detail'
                  ? undefined
                  : state.layout.maxHeight,
          }}
          onClick={state.content.isEditing ? undefined : (e) => enterContentEdit(e)}
        >
          {state.content.isEditing ? (
            <div className={styles.noteContentInput}>
              <RichTextEditor
                value={contentJsonDraft}
                onChange={onEditorChange}
                onBlur={() => {
                  dispatch({ type: 'BLUR_CONTENT_EXIT' });
                }}
                insideRefs={[contentEditActionsRef]}
              />
            </div>
          ) : (
            <div
              ref={textRef as any}
              className={`${styles.noteText} !leading-relaxed !text-gray-600`}
            >
              {(() => {
                const draftText = draft?.dirty ? draft?.text : contentTextDraft;
                const hasDraft =
                  !!draft?.dirty ||
                  (!!draftText);

                if (hasDraft && draft?.dirty) {
                  return <RichTextViewer value={draftText} />;
                }

                const finalMarkdown = note.contentText || note.content || '';
                return <RichTextViewer value={finalMarkdown} />;
              })()}
            </div>
          )}
        </div>
        {layoutVariant !== 'detail' && !state.content.isEditing && state.layout.canExpand && (
          <div className={`${styles.fadeOverlay} ${!state.expanded ? styles.fadeOverlayVisible : ''}`} />
        )}
        {layoutVariant !== 'detail' && state.layout.canExpand && !state.content.isEditing && (
          <button type="button" className={styles.expandPill} onClick={() => dispatch({ type: 'TOGGLE_EXPANDED' })}>
            {state.expanded ? '收起' : '展开'}
          </button>
        )}

      </div>

      <div className={styles.noteKeywords}>
        <div className={styles.keywordsWrap}>
        {note.enriching && (!(note.keywords && note.keywords.length)) ? (
          <>
            <span className={styles.chipSkeleton} />
            <span className={styles.chipSkeleton} />
            <span className={styles.chipSkeleton} />
          </>
        ) : (
          <>
            {(() => {
              const kws = note.keywords || [];
              const addingIndex = kws.length;
              return (
                <>
                  {kws.length > 0 ? (
                    kws.map((kw, idx) => (
                activeKeywordIndex === idx ? (
                  <input
                    key={idx}
                    className={`${styles.keywordEditInput} !rounded-full !text-xs !px-3 !py-1 !border-gray-300 focus:!border-blue-400 focus:!ring-2 focus:!ring-blue-100`}
                    value={tagEditValue}
                    autoFocus
                    onChange={(e) => setTagEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitKeywordAt(idx);
                      } else if (e.key === 'Escape') {
                        setActiveKeywordIndex(null);
                        setTagEditValue('');
                      }
                    }}
                    onBlur={() => {
                      commitKeywordAt(idx);
                    }}
                  />
                ) : (
                  <span
                    key={idx}
                    className={`${styles.keyword} !bg-gray-100 hover:!bg-gray-200 !text-gray-600 !rounded-full !text-xs !border-none !px-3 !py-1`}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setActiveKeywordIndex(idx); setTagEditValue(kw); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setActiveKeywordIndex(idx); setTagEditValue(kw); } }}
                  >
                    {kw}
                    <button
                      type="button"
                      className={`${styles.keywordDeleteBtn} !bg-white !text-gray-500 hover:!text-red-500 !border-gray-200`}
                      aria-label="删除关键词"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteKeywordAt(idx);
                      }}
                    >
                      ×
                    </button>
                  </span>
                )
              ))
                  ) : null}

                  {/* 添加态输入框：idx === keywords.length（即新增） */}
                  {activeKeywordIndex === addingIndex && (
                    <input
                      key="__add_keyword__"
                      className={`${styles.keywordEditInput} !rounded-full !text-xs !px-3 !py-1 !border-gray-300 focus:!border-blue-400 focus:!ring-2 focus:!ring-blue-100`}
                      value={tagEditValue}
                      autoFocus
                      onChange={(e) => setTagEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitKeywordAt(addingIndex);
                        } else if (e.key === 'Escape') {
                          setActiveKeywordIndex(null);
                          setTagEditValue('');
                        }
                      }}
                      onBlur={() => commitKeywordAt(addingIndex)}
                      placeholder="新增关键词"
                    />
                  )}

                  {/* 常驻添加按钮 */}
                  {activeKeywordIndex !== addingIndex && (
                    <button
                      type="button"
                      className={`${styles.keywordAddBtn} flex items-center justify-center !bg-transparent !border !border-dashed !border-gray-300 hover:!border-gray-400 !text-gray-400 hover:!text-gray-600 !rounded-full !w-6 !h-6`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveKeywordIndex(addingIndex);
                        setTagEditValue('');
                      }}
                      aria-label="添加关键词"
                    >
                      <span className={styles.keywordAddIcon}>
                        <PlusIcon size={14} strokeWidth={2} />
                      </span>
                    </button>
                  )}
                </>
              );
            })()}
          </>
        )}
        </div>

        <div className={styles.noteKeywordsRight}>
          {/* 草稿提示：固定在 keywords 行尾（编辑/非编辑都显示） */}
          {contentSavedFlash ? (
            <div className={styles.draftSavedInline}>修改已提交 ✔</div>
          ) : (
            hasUnsavedDraft && <div className={styles.draftUnsavedInline}>草稿未保存 ！</div>
          )}

          {/* 编辑态操作：放在 keywords 行尾（在草稿提示之后），避免占用正文高度 */}
          {state.content.isEditing && (
            <div className={styles.noteEditActions} ref={contentEditActionsRef}>
              <button
                type="button"
                className={`${styles.noteEditCancel} !bg-white hover:!bg-gray-50 !text-gray-600 !border !border-gray-200 !rounded-lg !px-3 !py-1 !text-sm`}
                onClick={handleCancelContent}
                disabled={state.content.saving}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.noteEditSave} !bg-blue-600 hover:!bg-blue-700 !text-white !rounded-lg !px-3 !py-1 !border-none !text-sm`}
                onClick={handleSaveContent}
                disabled={state.content.saving}
              >
                保存
              </button>
              {state.content.error && <span className={styles.errorInline}>{state.content.error}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef } from 'react';
import cardStyles from '../styles/note-card.module.scss';
import editorStyles from '../styles/rich-editor.module.scss';
import TrashIcon from '../../../components/icons/TrashIcon';
import PlusIcon from '../../../components/icons/PlusIcon';
import type { Note } from '../hooks/useNotes';
import type { IRecommendCache } from '../../../types';
import { focusProseMirrorWithin } from './focusProseMirror';
import RichTextViewer from './RichTextViewer';
import { useNoteEditor } from '../hooks/useNoteEditor';
import { JSONContent } from '@tiptap/react';

function EditorLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="h-5 w-5 animate-spin rounded-full border-[3px] border-gray-200 border-t-gray-400" />
    </div>
  );
}

const RichTextEditorPromise = import('./RichTextEditor');
const RichTextEditor = dynamic(() => RichTextEditorPromise, {
  ssr: false,
  loading: () => <EditorLoadingPlaceholder />,
});

interface NoteCardProps {
  note: Note;
  onRequestDelete: (id: string) => void;
  isHighlighted?: boolean;
  onUpdateTitle: (id: string, newTitle: string, updatedAt?: string) => void;
  onUpdateContent?: (
    id: string,
    newContent: string,
    updatedAt?: string,
    contentJson?: JSONContent,
    contentText?: string,
    embedding?: number[]
  ) => void;
  onUpdateKeywords?: (id: string, newKeywords: string[], updatedAt?: string) => void;
  onUpdateRecommendCache?: (id: string, recommendCache: IRecommendCache | null) => void;
  onContentEditingChange?: (id: string, isEditing: boolean) => void;
  draft?: { json: JSONContent; text: string; dirty: boolean };
  onDraftChange?: (id: string, draft: { json: JSONContent; text: string; dirty: boolean }) => void;
  exitEditSignal?: number;
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
  onUpdateRecommendCache,
  onContentEditingChange,
  draft,
  onDraftChange,
  exitEditSignal,
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
  } = useNoteEditor({
    note,
    onUpdateTitle,
    onUpdateContent,
    onUpdateKeywords,
    onUpdateRecommendCache,
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

  // 进入编辑态：自动聚焦并把光标放到末尾（标题/正文复用同一逻辑）
  useFocusCursorToEnd(state.title.isEditing, titleInputRef);

  const alignTo = (_anchor: 'top' | 'bottom') => {
    const card = rootRef.current;
    if (!card) return;
    const scroller = findScrollParent(card);
    if (!scroller) return;

    const sr = scroller.getBoundingClientRect();
    const cr = card.getBoundingClientRect();

    // 仅在卡片上边缘被遮挡时向上滚动找回；下边缘溢出时不调整
    // ——让卡片在当前位置向下展开，上边缘不跳动
    if (cr.top < sr.top) {
      scroller.scrollTop += cr.top - sr.top;
    }
  };
  const applyTextareaSize = (opts: { align: boolean }) => {
    const card = rootRef.current;
    if (!card) return;

    if (opts.align) alignTo(anchorRef.current);

    // Remove height constraints and scrolling from ALL scrollable layers
    const scroller = card.querySelector(`.${editorStyles.richEditorScroller}`) as HTMLElement | null;
    const content = card.querySelector(`.${editorStyles.richEditorContent}`) as HTMLElement | null;
    const pm = card.querySelector('.ProseMirror') as HTMLElement | null;

    for (const el of [scroller, content, pm]) {
      if (!el) continue;
      el.style.overflowY = 'visible';
      el.style.overflowX = 'visible';
      el.style.maxHeight = 'none';
      el.style.height = 'auto';
    }
  };
  useEffect(() => {
    if (!state.content.isEditing) {
      const card = rootRef.current;
      if (card) {
        const scroller = card.querySelector(`.${editorStyles.richEditorScroller}`) as HTMLElement | null;
        const content = card.querySelector(`.${editorStyles.richEditorContent}`) as HTMLElement | null;
        const pm = card.querySelector('.ProseMirror') as HTMLElement | null;
        for (const el of [scroller, content, pm]) {
          if (!el) continue;
          el.style.overflowY = '';
          el.style.overflowX = '';
          el.style.maxHeight = '';
          el.style.height = '';
        }
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
    });
  }, [state.content.isEditing]);

  useEffect(() => {
    if (!state.content.isEditing) return;
    return focusProseMirrorWithin(rootRef.current);
  }, [state.content.isEditing]);


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
    cardStyles.noteCard,
    activeHighlight ? cardStyles.noteCardHighlight : '',
    state.content.isEditing ? cardStyles.noteCardEditing : '',
    // 当处于高亮状态时，移除 !bg-white 和 !shadow-none 强制覆盖，让 CSS Module 中的动画样式接管
    !activeHighlight ? '!bg-white !shadow-none' : '',
    '!border',
    isSelected ? '!border-blue-500 !ring-1 !ring-blue-500' : '!border-gray-100',
    '!rounded-xl'
  ].filter(Boolean).join(' ');
  const hasUnsavedDraft = !!draft?.dirty;

  return (
    <div
      ref={rootRef}
      className={cardClassName}
    >
      {/* 右侧悬浮把手 */}
      <button
        className={`${cardStyles.relatedHandle} ${isSelected ? cardStyles.relatedHandleActive : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        title="查看相关笔记"
        aria-label="查看相关笔记"
      >
        <div className={cardStyles.relatedHandleIcon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="15" y1="3" x2="15" y2="21"></line>
          </svg>
        </div>
      </button>

      <div
        className={cardStyles.noteHeader}
        onClick={() => dispatch({ type: 'TOGGLE_EXPANDED' })}
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
              className={cardStyles.noteTitleInput}
              placeholder="添加标题..."
              maxLength={100}
            />
          </div>
        ) : (
          <div
            className={`${cardStyles.noteTitle} !font-semibold !text-gray-900 !text-lg`}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'ENTER_TITLE_EDIT', value: note.title || '' });
            }}
          >
            {note.enriching && (!note.title || note.title.trim().length === 0) ? (
              <div className={cardStyles.titleSkeleton} />
            ) : (
              note.title || '点击添加标题'
            )}
          </div>
        )}
        <div className={`${cardStyles.noteActions} !gap-2`}>
          {state.title.isEditing && (
            <button
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSaveTitle();
              }}
              className={`${cardStyles.noteEditTitleConfirm} !bg-gray-100 hover:!bg-gray-200 !text-gray-600`}
              aria-label="保存标题"
              disabled={state.title.saving}
            >
              ✓
            </button>
          )}
          <span className={`${cardStyles.noteDate} !bg-transparent !text-gray-400 !border-none !p-0 !text-sm`}>{formatDate(note.createdAt)}</span>
          <button
            className={`${cardStyles.deleteButton} !bg-transparent !text-gray-400 hover:!text-red-500 hover:!bg-gray-100 !rounded-md !border-none !shadow-none !p-1`}
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(note._id);
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className={cardStyles.noteContent} ref={contentAreaRef}>
        <div
          ref={wrapperRef}
          className={state.content.isEditing ? cardStyles.noteTextWrapperEditing : cardStyles.noteTextWrapper}
          style={{
            maxHeight:
              state.content.isEditing
                ? undefined
                : state.layout.maxHeight,
          }}
          onClick={state.content.isEditing ? undefined : (e) => enterContentEdit(e)}
        >
          {state.content.isEditing ? (
            <div className={cardStyles.noteContentInput}>
              <RichTextEditor
                value={contentJsonDraft}
                onChange={onEditorChange}
                autoFocus="end"
                onBlur={() => {
                  dispatch({ type: 'BLUR_CONTENT_EXIT' });
                }}
                insideRefs={[contentEditActionsRef]}
              />
            </div>
          ) : (
            <div
              ref={textRef as React.RefObject<HTMLDivElement>}
              className={`${cardStyles.noteText} !leading-relaxed !text-gray-600`}
            >
              {(() => {
                const draftText = draft?.dirty ? draft?.text : contentTextDraft;
                const hasDraft =
                  !!draft?.dirty ||
                  (!!draftText);

                if (hasDraft && draft?.dirty) {
                  return <RichTextViewer value={draft?.json || draftText} />;
                }

                const finalContent = note.contentJson || note.contentText || note.content || '';
                return <RichTextViewer value={finalContent} />;
              })()}
            </div>
          )}
        </div>
        {!state.content.isEditing && state.layout.canExpand && (
          <div className={`${cardStyles.fadeOverlay} ${!state.expanded ? cardStyles.fadeOverlayVisible : ''}`} />
        )}
        {state.layout.canExpand && !state.content.isEditing && (
          <button type="button" className={cardStyles.expandPill} onClick={() => dispatch({ type: 'TOGGLE_EXPANDED' })}>
            {state.expanded ? '收起' : '展开'}
          </button>
        )}

      </div>

      <div className={cardStyles.noteKeywords}>
        <div className={cardStyles.keywordsWrap}>
        {note.enriching && (!(note.keywords && note.keywords.length)) ? (
          <>
            <span className={cardStyles.chipSkeleton} />
            <span className={cardStyles.chipSkeleton} />
            <span className={cardStyles.chipSkeleton} />
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
                    className={`${cardStyles.keywordEditInput} !rounded-full !text-xs !px-3 !py-1 !border-gray-300 focus:!border-blue-400 focus:!ring-2 focus:!ring-blue-100`}
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
                    className={`${cardStyles.keyword} !bg-gray-100 hover:!bg-gray-200 !text-gray-600 !rounded-full !text-xs !border-none !px-3 !py-1`}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setActiveKeywordIndex(idx); setTagEditValue(kw); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setActiveKeywordIndex(idx); setTagEditValue(kw); } }}
                  >
                    {kw}
                    <button
                      type="button"
                      className={`${cardStyles.keywordDeleteBtn} !bg-white !text-gray-500 hover:!text-red-500 !border-gray-200`}
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
                      className={`${cardStyles.keywordEditInput} !rounded-full !text-xs !px-3 !py-1 !border-gray-300 focus:!border-blue-400 focus:!ring-2 focus:!ring-blue-100`}
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
                      className={`${cardStyles.keywordAddBtn} flex items-center justify-center !bg-transparent !border !border-dashed !border-gray-300 hover:!border-gray-400 !text-gray-400 hover:!text-gray-600 !rounded-full !w-6 !h-6`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveKeywordIndex(addingIndex);
                        setTagEditValue('');
                      }}
                      aria-label="添加关键词"
                    >
                      <span className={cardStyles.keywordAddIcon}>
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

        <div className={cardStyles.noteKeywordsRight}>
          {/* 草稿提示：固定在 keywords 行尾（编辑/非编辑都显示） */}
          {contentSavedFlash ? (
            <div className={cardStyles.draftSavedInline}>修改已提交 ✔</div>
          ) : (
            hasUnsavedDraft && <div className={cardStyles.draftUnsavedInline}>草稿未保存 ！</div>
          )}

          {/* 编辑态操作：放在 keywords 行尾（在草稿提示之后），避免占用正文高度 */}
          {state.content.isEditing && (
            <div className={cardStyles.noteEditActions} ref={contentEditActionsRef}>
              <button
                type="button"
                className={`${cardStyles.noteEditCancel} !bg-white hover:!bg-gray-50 !text-gray-600 !border !border-gray-200 !rounded-lg !px-3 !py-1 !text-sm`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={handleCancelContent}
                disabled={state.content.saving}
              >
                取消
              </button>
              <button
                type="button"
                className={`${cardStyles.noteEditSave} !bg-blue-600 hover:!bg-blue-700 !text-white !rounded-lg !px-3 !py-1 !border-none !text-sm`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={handleSaveContent}
                disabled={state.content.saving}
              >
                保存
              </button>
              {state.content.error && <span className={cardStyles.errorInline}>{state.content.error}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

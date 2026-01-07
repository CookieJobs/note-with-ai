'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import styles from '../notes.module.scss';
import TrashIcon from '../../../components/icons/TrashIcon';
import { authFetch } from '../../../utils/auth';
import type { Note } from '../types';

interface NoteCardProps {
  note: Note;
  onRequestDelete: (id: string) => void;
  isHighlighted?: boolean;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onUpdateContent?: (id: string, newContent: string, updatedAt?: string) => void;
  onUpdateKeywords?: (id: string, newKeywords: string[], updatedAt?: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  onContentEditingChange?: (id: string, isEditing: boolean) => void;
}

type State = {
  expanded: boolean;
  title: {
    isEditing: boolean;
    value: string;
    saving: boolean;
  };
  content: {
    isEditing: boolean;
    value: string;
    original: string;
    draft: string | null;
    saving: boolean;
    error: string;
  };
  layout: {
    canExpand: boolean;
    maxHeight: string;
  };
};

type Action =
  | { type: 'TOGGLE_EXPANDED' }
  | { type: 'ENTER_TITLE_EDIT'; value: string }
  | { type: 'CHANGE_TITLE'; value: string }
  | { type: 'CANCEL_TITLE_EDIT'; value: string }
  | { type: 'SAVE_TITLE_START' }
  | { type: 'SAVE_TITLE_SUCCESS'; value: string }
  | { type: 'SAVE_TITLE_FAIL' }
  | { type: 'SYNC_TITLE_FROM_NOTE'; value: string }
  | { type: 'ENTER_CONTENT_EDIT'; original: string; value: string }
  | { type: 'CHANGE_CONTENT'; value: string }
  | { type: 'BLUR_CONTENT_EXIT' }
  | { type: 'CANCEL_CONTENT_EDIT'; value: string }
  | { type: 'SAVE_CONTENT_START' }
  | { type: 'SAVE_CONTENT_SUCCESS'; value: string }
  | { type: 'SAVE_CONTENT_FAIL'; error: string }
  | { type: 'SYNC_CONTENT_FROM_NOTE'; value: string }
  | { type: 'SET_CAN_EXPAND'; value: boolean }
  | { type: 'SET_MAX_HEIGHT'; value: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'TOGGLE_EXPANDED':
      return { ...state, expanded: !state.expanded };

    case 'ENTER_TITLE_EDIT':
      return {
        ...state,
        title: { ...state.title, isEditing: true, value: action.value, saving: false },
      };

    case 'CHANGE_TITLE':
      return { ...state, title: { ...state.title, value: action.value } };

    case 'CANCEL_TITLE_EDIT':
      return { ...state, title: { ...state.title, isEditing: false, value: action.value, saving: false } };

    case 'SAVE_TITLE_START':
      return { ...state, title: { ...state.title, saving: true } };

    case 'SAVE_TITLE_SUCCESS':
      return { ...state, title: { isEditing: false, value: action.value, saving: false } };

    case 'SAVE_TITLE_FAIL':
      return { ...state, title: { ...state.title, saving: false } };

    case 'SYNC_TITLE_FROM_NOTE':
      if (state.title.isEditing) return state;
      return { ...state, title: { ...state.title, value: action.value } };

    case 'ENTER_CONTENT_EDIT':
      return {
        ...state,
        content: {
          ...state.content,
          isEditing: true,
          original: action.original,
          value: action.value,
          error: '',
          saving: false,
        },
        layout: { ...state.layout, canExpand: false },
      };

    case 'CHANGE_CONTENT':
      return {
        ...state,
        content: { ...state.content, value: action.value, draft: action.value },
      };

    case 'BLUR_CONTENT_EXIT':
      return {
        ...state,
        content: { ...state.content, isEditing: false },
      };

    case 'CANCEL_CONTENT_EDIT':
      return {
        ...state,
        content: { ...state.content, isEditing: false, value: action.value, original: action.value, draft: null, error: '' },
      };

    case 'SAVE_CONTENT_START':
      return { ...state, content: { ...state.content, saving: true, error: '' } };

    case 'SAVE_CONTENT_SUCCESS':
      return {
        ...state,
        content: { ...state.content, isEditing: false, saving: false, value: action.value, original: action.value, draft: null, error: '' },
      };

    case 'SAVE_CONTENT_FAIL':
      return { ...state, content: { ...state.content, saving: false, error: action.error } };

    case 'SYNC_CONTENT_FROM_NOTE':
      if (state.content.isEditing) return state;
      if (state.content.draft !== null) return state;
      return { ...state, content: { ...state.content, value: action.value, original: action.value, error: '' } };

    case 'SET_CAN_EXPAND':
      return { ...state, layout: { ...state.layout, canExpand: action.value } };

    case 'SET_MAX_HEIGHT':
      return { ...state, layout: { ...state.layout, maxHeight: action.value } };

    default:
      return state;
  }
}

function initState(note: Note): State {
  return {
    expanded: false,
    title: { isEditing: false, value: note.title || '', saving: false },
    content: {
      isEditing: false,
      value: note.content || '',
      original: note.content || '',
      draft: null,
      saving: false,
      error: '',
    },
    layout: { canExpand: false, maxHeight: '' },
  };
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
}: NoteCardProps) {
  const [state, dispatch] = useReducer(reducer, note, initState);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<'top' | 'bottom'>('top');
  const didEnterLayoutRef = useRef(false);

  const [activeKeywordIndex, setActiveKeywordIndex] = useState<number | null>(null);
  const [tagEditValue, setTagEditValue] = useState<string>('');

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return '今天';
    if (diffDays === 2) return '昨天';
    if (diffDays <= 7) return `${diffDays - 1} 天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    dispatch({ type: 'SYNC_TITLE_FROM_NOTE', value: note.title || '' });
  }, [note.title]);

  useEffect(() => {
    dispatch({ type: 'SYNC_CONTENT_FROM_NOTE', value: note.content || '' });
  }, [note.content]);

  // 进入编辑态：自动聚焦并把光标放到末尾（标题/正文复用同一逻辑）
  useFocusCursorToEnd(state.title.isEditing, titleInputRef);
  useFocusCursorToEnd(state.content.isEditing, contentTextareaRef);

  // 正文编辑态：通知页面（用于强制收缩快速记录）
  useEffect(() => {
    onContentEditingChange?.(note._id, state.content.isEditing);
  }, [note._id, onContentEditingChange, state.content.isEditing]);

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
    const card = rootRef.current;
    const ta = contentTextareaRef.current;
    if (!card || !ta) return;
    const scroller = findScrollParent(card);
    if (!scroller) return;

    const defaultMinH = 120;

    if (opts.align) alignTo(anchorRef.current);

    const sr = scroller.getBoundingClientRect();

    const prevMinH = ta.style.minHeight;
    const prevH = ta.style.height;
    const prevMaxH = ta.style.maxHeight;
    const prevOverflowY = ta.style.overflowY;
    const prevResize = ta.style.resize;

    // fixedH：卡片中“除 textarea 外”的固定高度
    ta.style.minHeight = '0px';
    ta.style.height = '0px';
    ta.style.maxHeight = 'none';
    ta.style.overflowY = 'hidden';
    const cardH0 = card.getBoundingClientRect().height;
    const taH0 = ta.getBoundingClientRect().height;
    const fixedH = Math.max(0, cardH0 - taH0);

    // fullH：正文全部展开需要的高度
    ta.style.height = 'auto';
    ta.style.maxHeight = 'none';
    const fullH = ta.scrollHeight;

    // 关键约束：卡片高度不能超过滚动容器可视高度（避免被上方快速记录挡住）
    // => textarea 最大高度 = sr.height - fixedH
    const maxTaH = Math.max(0, sr.height - fixedH);
    const minTaH = Math.min(defaultMinH, maxTaH);
    const nextH = Math.max(minTaH, Math.min(fullH, maxTaH));

    ta.style.maxHeight = `${maxTaH}px`;
    ta.style.height = `${nextH}px`;
    ta.style.overflowY = fullH > maxTaH ? 'auto' : 'hidden';
    ta.style.resize = 'none';

    // 恢复 min-height（默认外观仍由 CSS 控制）
    ta.style.minHeight = prevMinH;

    if (opts.align) alignTo(anchorRef.current);

    // 防御：极端情况下回滚
    if (!Number.isFinite(fullH) || !Number.isFinite(fixedH)) {
      ta.style.minHeight = prevMinH;
      ta.style.height = prevH;
      ta.style.maxHeight = prevMaxH;
      ta.style.overflowY = prevOverflowY;
      ta.style.resize = prevResize;
    }
  };

  useEffect(() => {
    if (!state.content.isEditing) {
      didEnterLayoutRef.current = false;
      const ta = contentTextareaRef.current;
      if (ta) {
        ta.style.height = '';
        ta.style.maxHeight = '';
        ta.style.overflowY = '';
        ta.style.resize = '';
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
  }, [state.content.isEditing]);

  useEffect(() => {
    if (!state.content.isEditing) return;
    if (!didEnterLayoutRef.current) return;
    // 输入/内容变化时：只更新高度与内部滚动，不再做“吸顶/吸底”对齐（避免用户滚动时被强行拉回）
    requestAnimationFrame(() => applyTextareaSize({ align: false }));
  }, [state.content.value, state.content.isEditing]);

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

    if (state.expanded) {
      dispatch({ type: 'SET_MAX_HEIGHT', value: p.scrollHeight + 'px' });
    } else {
      dispatch({ type: 'SET_MAX_HEIGHT', value: collapsedH + 'px' });
    }
  }, [state.expanded, note.content, state.content.isEditing]);

  const handleSaveTitle = async () => {
    const next = state.title.value.trim();
    if (next === (note.title || '')) {
      dispatch({ type: 'CANCEL_TITLE_EDIT', value: note.title || '' });
      return;
    }

    dispatch({ type: 'SAVE_TITLE_START' });
    try {
      const response = await authFetch(`/api/notes/${note._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!response.ok) throw new Error('保存标题失败');

      onUpdateTitle(note._id, next);
      dispatch({ type: 'SAVE_TITLE_SUCCESS', value: next });
    } catch {
      dispatch({ type: 'SAVE_TITLE_FAIL' });
      dispatch({ type: 'CANCEL_TITLE_EDIT', value: note.title || '' });
    }
  };

  const handleSaveContent = async () => {
    if (!onUpdateContent) {
      dispatch({ type: 'BLUR_CONTENT_EXIT' });
      return;
    }

    const val = state.content.value;
    if (val.trim() === (note.content || '')) {
      dispatch({ type: 'BLUR_CONTENT_EXIT' });
      return;
    }

    dispatch({ type: 'SAVE_CONTENT_START' });
    try {
      const response = await authFetch(`/api/notes/${note._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: val, updatedAt: note.updatedAt }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          const serverNote = data?.data?.note;
          const serverContent = serverNote?.content;
          if (typeof serverContent === 'string') {
            onUpdateContent(note._id, serverContent, serverNote?.updatedAt);
            dispatch({ type: 'SAVE_CONTENT_SUCCESS', value: serverContent });
          } else {
            throw new Error('保存失败');
          }
        } else {
          throw new Error(data?.error || '保存失败');
        }
      } else {
        const updated = data?.data?.note || {};
        const nextContent = updated.content || val;
        onUpdateContent(note._id, nextContent, updated.updatedAt);
        authFetch(`/api/notes/${note._id}/embed`, { method: 'POST' }).catch(() => {});
        dispatch({ type: 'SAVE_CONTENT_SUCCESS', value: nextContent });
      }
    } catch (e: any) {
      dispatch({ type: 'SAVE_CONTENT_FAIL', error: e?.message || '保存失败' });
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dispatch({ type: 'CANCEL_TITLE_EDIT', value: note.title || '' });
    }
  };

  const cardClassName = `${styles.noteCard} ${isHighlighted ? styles.noteCardHighlight : ''} ${state.content.isEditing ? styles.noteCardEditing : ''}`;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        cardRef?.(el);
      }}
      className={cardClassName}
    >
      {/* 其余渲染保持不变 */}
      <div className={styles.noteHeader} onClick={() => dispatch({ type: 'TOGGLE_EXPANDED' })}>
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
            className={styles.noteTitle}
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
        <div className={styles.noteActions}>
          {state.title.isEditing && (
            <button
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSaveTitle();
              }}
              className={styles.noteEditTitleConfirm}
              aria-label="保存标题"
              disabled={state.title.saving}
            >
              ✓
            </button>
          )}
          <span className={styles.noteDate}>{formatDate(note.createdAt)}</span>
          <button
            className={styles.deleteButton}
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
          style={{ maxHeight: state.content.isEditing ? undefined : state.layout.maxHeight }}
        >
          {state.content.isEditing ? (
            <textarea
              ref={contentTextareaRef}
              className={styles.noteContentInput}
              value={state.content.value}
              onChange={(e) => {
                dispatch({ type: 'CHANGE_CONTENT', value: e.target.value });
              }}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (contentAreaRef.current && next && contentAreaRef.current.contains(next)) return;
                dispatch({ type: 'BLUR_CONTENT_EXIT' });
              }}
              rows={6}
            />
          ) : (
            <p
              ref={textRef}
              className={styles.noteText}
              onClick={() => {
                dispatch({
                  type: 'ENTER_CONTENT_EDIT',
                  original: note.content || '',
                  value: state.content.draft !== null ? state.content.draft : (note.content || ''),
                });
              }}
            >
              {note.content}
            </p>
          )}
        </div>
        {!state.content.isEditing && state.layout.canExpand && (
          <div className={`${styles.fadeOverlay} ${!state.expanded ? styles.fadeOverlayVisible : ''}`} />
        )}
        <div className={styles.noteEditBar}>
          {state.content.isEditing && (
            <div className={styles.noteEditActions}>
              <button
                type="button"
                className={styles.noteEditCancel}
                onClick={() => {
                  dispatch({ type: 'CANCEL_CONTENT_EDIT', value: state.content.original });
                }}
                disabled={state.content.saving}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.noteEditSave}
                onClick={handleSaveContent}
                disabled={state.content.saving}
              >
                保存
              </button>
              {state.content.error && <span className={styles.errorInline}>{state.content.error}</span>}
            </div>
          )}
        </div>
        {state.layout.canExpand && !state.content.isEditing && (
          <button type="button" className={styles.expandPill} onClick={() => dispatch({ type: 'TOGGLE_EXPANDED' })}>
            {state.expanded ? '收起' : '展开'}
          </button>
        )}
      </div>

      <div className={styles.noteKeywords}>
        {note.enriching && (!(note.keywords && note.keywords.length)) ? (
          <>
            <span className={styles.chipSkeleton} />
            <span className={styles.chipSkeleton} />
            <span className={styles.chipSkeleton} />
          </>
        ) : (
          <>
            {(note.keywords && note.keywords.length > 0) ? (
              (note.keywords || []).map((kw, idx) => (
                activeKeywordIndex === idx ? (
                  <input
                    key={idx}
                    className={styles.keywordEditInput}
                    value={tagEditValue}
                    autoFocus
                    onChange={(e) => setTagEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const arr = [...(note.keywords || [])];
                        const v = tagEditValue.trim();
                        if (v) arr[idx] = v; else arr.splice(idx, 1);
                        authFetch(`/api/notes/${note._id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ keywords: arr, updatedAt: note.updatedAt }),
                        })
                          .then((r) => r.json())
                          .then((data) => {
                            const updated = data?.data?.note;
                            const next = Array.isArray(updated?.keywords) ? updated.keywords : arr;
                            onUpdateKeywords && onUpdateKeywords(note._id, next, updated?.updatedAt);
                            setActiveKeywordIndex(null);
                            setTagEditValue('');
                          })
                          .catch(() => { setActiveKeywordIndex(null); setTagEditValue(''); });
                      } else if (e.key === 'Escape') {
                        setActiveKeywordIndex(null);
                        setTagEditValue('');
                      }
                    }}
                    onBlur={() => {
                      const arr = [...(note.keywords || [])];
                      const v = tagEditValue.trim();
                      if (v) arr[idx] = v; else arr.splice(idx, 1);
                      authFetch(`/api/notes/${note._id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ keywords: arr, updatedAt: note.updatedAt }),
                      })
                        .then((r) => r.json())
                        .then((data) => {
                          const updated = data?.data?.note;
                          const next = Array.isArray(updated?.keywords) ? updated.keywords : arr;
                          onUpdateKeywords && onUpdateKeywords(note._id, next, updated?.updatedAt);
                        })
                        .finally(() => { setActiveKeywordIndex(null); setTagEditValue(''); });
                    }}
                  />
                ) : (
                  <span
                    key={idx}
                    className={styles.keyword}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setActiveKeywordIndex(idx); setTagEditValue(kw); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setActiveKeywordIndex(idx); setTagEditValue(kw); } }}
                  >
                    {kw}
                  </span>
                )
              ))
            ) : (
              <span
                className={styles.keyword}
                role="button"
                tabIndex={0}
                onClick={() => { setActiveKeywordIndex(0); setTagEditValue(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { setActiveKeywordIndex(0); setTagEditValue(''); } }}
              >
                点击添加关键词
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}



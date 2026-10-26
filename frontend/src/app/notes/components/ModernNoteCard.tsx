'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useCallback } from 'react';
import cardStyles from '../styles/note-card.module.scss';
import editorStyles from '../styles/rich-editor.module.scss';
import TrashIcon from '../../../components/icons/TrashIcon';
import type { Note, UpdateNoteCommand } from '../hooks/useNotes';
import { focusProseMirrorWithin } from './focusProseMirror';
import RichTextViewer from './RichTextViewer';
import { useNoteEditor } from '../hooks/useNoteEditor';
import { flomoEditorChromeProps } from './richTextEditorPresets';
import { loadRichTextEditor } from './richTextEditorLoader';
import { useNoteTitleSuggestion } from '../../../hooks/useNoteTitleSuggestion';
import type { NoteEditDraft } from '../hooks/useNoteEditor';
import NoteTitleField from './NoteTitleField';
import { hasTitleSourceText } from '../utils/titleValidation';
import { Pencil } from 'lucide-react';

function EditorLoadingPlaceholder() {
  return (
    <div className="space-y-3 py-2">
      <div className="h-4 w-5/6 animate-pulse rounded-full bg-gray-100" />
      <div className="h-4 w-2/3 animate-pulse rounded-full bg-gray-100" />
    </div>
  );
}

const RichTextEditor = dynamic(loadRichTextEditor, {
  ssr: false,
  loading: () => <EditorLoadingPlaceholder />,
});

interface NoteCardProps {
  note: Note;
  userId?: string | null;
  onRegisterInvalidate?: (noteId: string, invalidate: () => void) => () => void;
  onRequestDelete: (id: string) => void;
  isHighlighted?: boolean;
  updateNote: (command: UpdateNoteCommand) => Promise<Note>;
  onContentEditingChange?: (id: string, isEditing: boolean) => void;
  draft?: NoteEditDraft;
  onDraftChange?: (id: string, draft: NoteEditDraft | null) => void;
  isContentEditingActive?: boolean;
  onClick?: () => void;
  isSelected?: boolean;
}

function useFocusCursorToEnd(
  isActive: boolean,
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
) {
  useEffect(() => {
    if (!isActive) return;
    const frame = requestAnimationFrame(() => {
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
    return () => cancelAnimationFrame(frame);
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
  userId = null,
  onRegisterInvalidate,
  onRequestDelete,
  isHighlighted,
  updateNote,
  onContentEditingChange,
  draft,
  onDraftChange,
  isContentEditingActive = false,
  onClick,
  isSelected,
}: NoteCardProps) {
  const {
    state,
    dispatch,
    contentJsonDraft,
    contentTextDraft,
    contentSavedFlash,
    beginTitleEdit,
    changeTitle,
    handleSaveContent,
    handleCancelContent,
    enterContentEdit,
    onEditorChange,
  } = useNoteEditor({
    note,
    userId,
    updateNote,
    onContentEditingChange,
    draft,
    onDraftChange,
    isContentEditingActive,
  });
  const suggestion = useNoteTitleSuggestion({
    userId, editorSessionId: note._id, open: state.content.isEditing,
    getBody: () => (contentJsonDraft ?? note.contentJson) ? { kind: 'rich-text', document: (contentJsonDraft ?? note.contentJson) as Record<string, unknown> }
      : { kind: 'plain-text', text: note.contentText ?? note.content },
    getTitle: () => state.title.value,
    onApply: changeTitle,
  });
  useEffect(() => onRegisterInvalidate?.(note._id, suggestion.invalidate), [onRegisterInvalidate, note._id, suggestion.invalidate]);

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
  const titleEditorRef = useRef<HTMLDivElement | null>(null);
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const contentEditActionsRef = useRef<HTMLDivElement | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const titleEditTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editOriginRef = useRef<'title' | 'content'>('content');
  const [restoreEditFocus, setRestoreEditFocus] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const anchorRef = useRef<'top' | 'bottom'>('top');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!restoreEditFocus || state.content.isEditing) return;
    const trigger = editOriginRef.current === 'title'
      ? titleEditTriggerRef.current ?? editTriggerRef.current
      : editTriggerRef.current;
    trigger?.focus();
    setRestoreEditFocus(false);
  }, [restoreEditFocus, state.content.isEditing]);

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

  const alignTo = useCallback((_anchor: 'top' | 'bottom') => {
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
  }, []);
  const applyTextareaSize = useCallback((opts: { align: boolean }) => {
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
  }, [alignTo]);
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
  }, [applyTextareaSize, state.content.isEditing]);

  useEffect(() => {
    if (!state.content.isEditing || state.title.isEditing) return;
    return focusProseMirrorWithin(rootRef.current);
  }, [state.content.isEditing, state.title.isEditing]);


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
  }, [dispatch, note.content, state.content.isEditing]);

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
  }, [dispatch, state.expanded, state.content.isEditing, note.content, note.contentText, note.contentJson]);

  const cancelEdit = () => {
    suggestion.invalidate();
    handleCancelContent();
    setRestoreEditFocus(true);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        saveEdit();
      } else {
        dispatch({ type: 'BLUR_TITLE_EXIT' });
        focusProseMirrorWithin(rootRef.current);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const saveEdit = () => {
    suggestion.invalidate();
    void handleSaveContent();
  };

  const cardClassName = [
    cardStyles.noteCard,
    activeHighlight ? cardStyles.noteCardHighlight : '',
    state.content.isEditing ? cardStyles.noteCardEditing : '',
    isSelected ? cardStyles.noteCardSelected : '',
  ].filter(Boolean).join(' ');
  const visibleTitle = state.title.value.trim();

  return (
    <div
      ref={rootRef}
      className={cardClassName}
      data-note-id={note._id}
    >

      {!state.content.isEditing && visibleTitle && (
        <div className={cardStyles.noteHeader}>
          <button
            ref={titleEditTriggerRef}
            type="button"
            aria-label={`编辑笔记标题：${visibleTitle}`}
            className={cardStyles.noteTitle}
            onClick={(e) => {
              e.stopPropagation();
              editOriginRef.current = 'title';
              beginTitleEdit();
            }}
          >
            {visibleTitle}
          </button>
        </div>
      )}

      {state.content.isEditing && (
        <div ref={titleEditorRef}>
          <NoteTitleField
            value={state.title.value}
            inputRef={titleInputRef}
            onChange={(value) => { suggestion.invalidate('title'); changeTitle(value); }}
            onKeyDown={handleTitleKeyDown}
            suggestion={suggestion}
            hasBodyText={hasTitleSourceText(contentJsonDraft ?? note.contentJson, contentTextDraft)}
            saving={state.content.saving}
          />
        </div>
      )}

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
          onClick={state.content.isEditing ? undefined : (e) => {
            editOriginRef.current = 'content';
            enterContentEdit(e);
          }}
        >
          {state.content.isEditing ? (
            <div className={cardStyles.noteContentInput}>
              <RichTextEditor
                value={contentJsonDraft}
                onChange={(next) => { suggestion.invalidate('body'); onEditorChange(next); }}
                autoFocus={state.title.isEditing ? false : 'end'}
                  {...flomoEditorChromeProps}
                onBlur={() => {
                  suggestion.invalidate();
                  dispatch({ type: 'BLUR_CONTENT_EXIT' });
                }}
                insideRefs={[titleEditorRef, contentEditActionsRef]}
                onModEnter={saveEdit}
              />
            </div>
          ) : (
            <div
              ref={textRef as React.RefObject<HTMLDivElement>}
              className={cardStyles.noteText}
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

      <div className={cardStyles.noteFooter}>
        <time className={cardStyles.noteDate} dateTime={note.createdAt}>{formatDate(note.createdAt)}</time>
        {!state.content.isEditing && <div className={cardStyles.noteActions}>
          <button
            ref={editTriggerRef}
            type="button"
            className={cardStyles.relatedHandle}
            aria-label="编辑笔记"
            title="编辑笔记"
            onClick={(event) => {
              event.stopPropagation();
              editOriginRef.current = 'content';
              enterContentEdit();
            }}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
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
          <button
            className={cardStyles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              suggestion.invalidate();
              onRequestDelete(note._id);
            }}
          >
            <TrashIcon />
          </button>
        </div>}
      </div>

      {(state.title.isEditing || state.content.isEditing || draft?.dirty || state.title.error || state.content.error || suggestion.error) && (
        <div className={cardStyles.noteEditOperation} ref={contentEditActionsRef} data-note-editor-inside="true">
          {contentSavedFlash ? <span className={cardStyles.draftSavedInline}>已保存</span>
            : draft?.dirty ? <span className={cardStyles.draftUnsavedInline}>草稿未保存</span> : null}
          {state.content.isEditing && <span className={cardStyles.noteEditHint}>Cmd/Ctrl + Enter 保存</span>}
          <button type="button" className={cardStyles.noteEditCancel} onMouseDown={(e) => e.preventDefault()}
            onClick={cancelEdit}>取消</button>
          <button type="button" className={cardStyles.noteEditSave} onMouseDown={(e) => e.preventDefault()}
            onClick={saveEdit} disabled={state.content.saving}>{state.content.saving ? '保存中…' : '保存'}</button>
          {(state.title.error || state.content.error) && <span className={cardStyles.errorInline} role="alert">
            {state.title.error || state.content.error}
            {state.title.conflictCurrentTitle ? ` 服务端标题：${state.title.conflictCurrentTitle}` : ''}
          </span>}
          {state.content.conflictCurrentText && <span className={cardStyles.errorInline}>服务端当前正文：{state.content.conflictCurrentText}</span>}
        </div>
      )}

    </div>
  );
}

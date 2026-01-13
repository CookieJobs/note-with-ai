'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import styles from '../notes.module.scss';
import TrashIcon from '../../../components/icons/TrashIcon';
import { authFetch } from '../../../utils/auth';
import type { Note } from '../types';
import RichTextEditor from './RichTextEditor';
import RichTextViewer from './RichTextViewer';

interface NoteCardProps {
  note: Note;
  onRequestDelete: (id: string) => void;
  isHighlighted?: boolean;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onUpdateContent?: (id: string, newContent: string, updatedAt?: string, contentJson?: any, contentText?: string) => void;
  onUpdateKeywords?: (id: string, newKeywords: string[], updatedAt?: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  onContentEditingChange?: (id: string, isEditing: boolean) => void;
  /** detail: 右侧工作台放大展示（默认展开、禁用“展开/收起”交互） */
  layoutVariant?: 'list' | 'detail';
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
  | { type: 'SET_EXPANDED'; value: boolean }
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

    case 'SET_EXPANDED':
      return { ...state, expanded: action.value };

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
  layoutVariant = 'list',
}: NoteCardProps) {
  const [state, dispatch] = useReducer(reducer, note, initState);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const contentEditActionsRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<'top' | 'bottom'>('top');
  const didEnterLayoutRef = useRef(false);

  const [activeKeywordIndex, setActiveKeywordIndex] = useState<number | null>(null);
  const [tagEditValue, setTagEditValue] = useState<string>('');

  const [contentJsonDraft, setContentJsonDraft] = useState<any | null>(null);
  const [contentTextDraft, setContentTextDraft] = useState<string>('');
  const draftMetaRef = useRef<{ noteId: string | null; dirty: boolean }>({ noteId: null, dirty: false });
  const contentEditBaselineRef = useRef<{ noteId: string | null; jsonStr: string; text: string } | null>(null);
  const contentEditIgnoreFirstChangeRef = useRef<{ noteId: string | null; ignore: boolean }>({ noteId: null, ignore: false });
  const [contentSavedFlash, setContentSavedFlash] = useState(false);
  const contentSavedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (contentSavedTimerRef.current) window.clearTimeout(contentSavedTimerRef.current);
    };
  }, []);

  const getNotePlainText = () => {
    const t = note.contentText;
    if (typeof t === 'string' && t.trim().length > 0) return t;
    return note.content || '';
  };

  const buildJsonFromPlain = (text: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  });

  const safeStringify = (v: any) => {
    try {
      return JSON.stringify(v ?? null);
    } catch {
      return '';
    }
  };

  const extractPlainTextFromJson = (doc: any): string => {
    // 与 RichTextEditor 的提取规则一致：image => "[图片]"
    const out: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      const type = node.type;
      if (type === 'text' && typeof node.text === 'string') {
        out.push(node.text);
        return;
      }
      if (type === 'image') {
        if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out.push('\n');
        out.push('[图片]');
        out.push('\n');
        return;
      }
      if (type === 'hardBreak') {
        out.push('\n');
        return;
      }
      const content = Array.isArray(node.content) ? node.content : [];
      for (const c of content) walk(c);
      if (type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'listItem') {
        if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out.push('\n');
      }
    };
    walk(doc);
    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  };

  const getNoteTextForEditor = () => {
    // 解决“只有图片但 contentText 为空”的情况：进入编辑态用 contentJson 推导文本
    if (note.contentJson) {
      const t = extractPlainTextFromJson(note.contentJson);
      if (t) return t;
    }
    return getNotePlainText();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();

    // 按“日历日期”判断（本地 00:00），避免用时间戳差导致跨天显示不准
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const deltaDays = Math.floor((startOfDay(now) - startOfDay(date)) / (1000 * 60 * 60 * 24));

    if (deltaDays <= 0) return '今天';
    if (deltaDays === 1) return '昨天';
    if (deltaDays <= 29) return `${deltaDays} 天前`;

    // 更远：显示 N 月前 / N 年前（按“满月/满年”计算，避免 0 月前/0 年前）
    let monthsDiff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
    if (now.getDate() < date.getDate()) monthsDiff -= 1; // 未满一月不算
    monthsDiff = Math.max(0, monthsDiff);

    let yearsDiff = now.getFullYear() - date.getFullYear();
    if (
      now.getMonth() < date.getMonth() ||
      (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())
    ) {
      yearsDiff -= 1; // 未满一年不算
    }
    yearsDiff = Math.max(0, yearsDiff);

    if (yearsDiff >= 1) return `${yearsDiff} 年前`;
    if (monthsDiff >= 1) return `${monthsDiff} 月前`;

    // 兜底：避免出现“0 月前”，回退到日期显示
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    dispatch({ type: 'SYNC_TITLE_FROM_NOTE', value: note.title || '' });
  }, [note.title]);

  useEffect(() => {
    dispatch({ type: 'SYNC_CONTENT_FROM_NOTE', value: note.content || '' });
  }, [note.content]);

  // detail 模式：默认展开，且不展示“展开/收起”控件
  useEffect(() => {
    if (layoutVariant !== 'detail') return;
    if (!state.expanded) dispatch({ type: 'SET_EXPANDED', value: true });
    dispatch({ type: 'SET_CAN_EXPAND', value: false });
  }, [layoutVariant, state.expanded]);

  // 进入编辑态：自动聚焦并把光标放到末尾（标题/正文复用同一逻辑）
  useFocusCursorToEnd(state.title.isEditing, titleInputRef);

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

    const valText = (contentTextDraft || '').trim();
    const prevText = getNotePlainText().trim();

    // TipTap：格式化可能不改变纯文本（getText 不变），但 JSON 会变
    const prevJson = note.contentJson ?? buildJsonFromPlain(getNotePlainText());
    const nextJson = contentJsonDraft ?? buildJsonFromPlain(contentTextDraft || '');
    const prevJsonStr = safeStringify(prevJson);
    const nextJsonStr = safeStringify(nextJson);

    if (valText === prevText && prevJsonStr === nextJsonStr) {
      dispatch({ type: 'BLUR_CONTENT_EXIT' });
      return;
    }

    dispatch({ type: 'SAVE_CONTENT_START' });
    try {
      const response = await authFetch(`/api/notes/${note._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentText: contentTextDraft,
          contentJson: nextJson,
          updatedAt: note.updatedAt,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          const serverNote = data?.data?.note;
          const serverText = (serverNote?.contentText ?? serverNote?.content) as string | undefined;
          const serverJson = serverNote?.contentJson;
          if (typeof serverText === 'string') {
            onUpdateContent(note._id, serverText, serverNote?.updatedAt, serverJson, serverNote?.contentText);
            setContentTextDraft(serverText);
            setContentJsonDraft(serverJson ?? null);
            dispatch({ type: 'SAVE_CONTENT_SUCCESS', value: serverText });
          } else {
            throw new Error('保存失败');
          }
        } else {
          throw new Error(data?.error || '保存失败');
        }
      } else {
        const updated = data?.data?.note || {};
        const nextText = (updated.contentText ?? updated.content ?? contentTextDraft) as string;
        const nextJson = updated.contentJson ?? contentJsonDraft;
        onUpdateContent(note._id, nextText, updated.updatedAt, nextJson, updated.contentText);
        authFetch(`/api/notes/${note._id}/embed`, { method: 'POST' }).catch(() => {});
        dispatch({ type: 'SAVE_CONTENT_SUCCESS', value: nextText });

        // 保存成功：草稿归零（后续再进入编辑就用最新数据）
        draftMetaRef.current = { noteId: note._id, dirty: false };

        // 保存成功提示（2s 自动消失）
        setContentSavedFlash(true);
        if (contentSavedTimerRef.current) window.clearTimeout(contentSavedTimerRef.current);
        contentSavedTimerRef.current = window.setTimeout(() => setContentSavedFlash(false), 2000);
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

  const deleteKeywordAt = async (idx: number) => {
    if (!onUpdateKeywords) return;
    const arr = [...(note.keywords || [])];
    if (idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);

    try {
      const response = await authFetch(`/api/notes/${note._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: arr, updatedAt: note.updatedAt }),
      });
      const data = await response.json();
      const updated = data?.data?.note;
      const next = Array.isArray(updated?.keywords) ? updated.keywords : arr;
      onUpdateKeywords(note._id, next, updated?.updatedAt);
    } catch {
      // 静默失败：避免打断编辑；如需提示可后续加 toast
    } finally {
      // 如果刚好在编辑这个 tag，退出编辑态
      setActiveKeywordIndex(null);
      setTagEditValue('');
    }
  };

  const commitKeywordAt = async (idx: number) => {
    if (!onUpdateKeywords) {
      setActiveKeywordIndex(null);
      setTagEditValue('');
      return;
    }
    const arr = [...(note.keywords || [])];
    const v = tagEditValue.trim();
    if (v) arr[idx] = v;
    else if (idx < arr.length) arr.splice(idx, 1);
    else {
      // 添加态且为空：直接取消
      setActiveKeywordIndex(null);
      setTagEditValue('');
      return;
    }

    try {
      const response = await authFetch(`/api/notes/${note._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: arr, updatedAt: note.updatedAt }),
      });
      const data = await response.json();
      const updated = data?.data?.note;
      const next = Array.isArray(updated?.keywords) ? updated.keywords : arr;
      onUpdateKeywords(note._id, next, updated?.updatedAt);
    } finally {
      setActiveKeywordIndex(null);
      setTagEditValue('');
    }
  };

  const cardClassName = `${styles.noteCard} ${layoutVariant === 'detail' ? styles.noteCardDetail : ''} ${isHighlighted ? styles.noteCardHighlight : ''} ${state.content.isEditing ? styles.noteCardEditing : ''}`;
  const hasUnsavedDraft = draftMetaRef.current.noteId === note._id && draftMetaRef.current.dirty;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        cardRef?.(el);
      }}
      className={cardClassName}
    >
      {/* 其余渲染保持不变 */}
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
          style={{
            maxHeight:
              state.content.isEditing
                ? undefined
                : layoutVariant === 'detail'
                  ? undefined
                  : state.layout.maxHeight,
          }}
        >
          {state.content.isEditing ? (
            <div className={styles.noteContentInput}>
              <RichTextEditor
                value={contentJsonDraft}
                onChange={({ json, text }) => {
                  const jsonStr = safeStringify(json);
                  const baseline = contentEditBaselineRef.current;
                  // TipTap 初始化/同步也会触发一次 update：如果内容与 baseline 完全一致，不应标记为“草稿未保存”
                  if (
                    baseline &&
                    baseline.noteId === note._id &&
                    baseline.jsonStr === jsonStr &&
                    baseline.text === text
                  ) {
                    setContentJsonDraft(json);
                    setContentTextDraft(text);
                    return;
                  }

                  // 更强的防抖：进入编辑态后的第一次 onChange，常常来自 ProseMirror 的“结构规范化”
                  //（例如给只有图片的 doc 自动补一个空段落）。这不应算用户修改。
                  const ig = contentEditIgnoreFirstChangeRef.current;
                  if (ig && ig.noteId === note._id && ig.ignore) {
                    ig.ignore = false;
                    setContentJsonDraft(json);
                    setContentTextDraft(text);
                    contentEditBaselineRef.current = { noteId: note._id, jsonStr, text };
                    return;
                  }

                  setContentJsonDraft(json);
                  setContentTextDraft(text);
                  draftMetaRef.current = { noteId: note._id, dirty: true };
                  if (contentSavedFlash) setContentSavedFlash(false);
                  if (contentSavedTimerRef.current) {
                    window.clearTimeout(contentSavedTimerRef.current);
                    contentSavedTimerRef.current = null;
                  }
                  dispatch({ type: 'CHANGE_CONTENT', value: text });
                }}
                onBlur={() => {
                  dispatch({ type: 'BLUR_CONTENT_EXIT' });
                }}
                insideRefs={[contentEditActionsRef]}
              />
            </div>
          ) : (
            <div
              ref={textRef as any}
              className={styles.noteText}
              onClick={() => {
                // 如果有未保存草稿且属于当前 note，则继续用草稿；否则用服务端内容初始化
                if (draftMetaRef.current.noteId === note._id && draftMetaRef.current.dirty && contentJsonDraft) {
                  // keep draft
                } else {
                  const baseJson = note.contentJson ?? buildJsonFromPlain(getNotePlainText());
                  const baseText = extractPlainTextFromJson(baseJson) || getNoteTextForEditor();
                  setContentJsonDraft(baseJson);
                  setContentTextDraft(baseText);
                  draftMetaRef.current = { noteId: note._id, dirty: false };
                  contentEditBaselineRef.current = {
                    noteId: note._id,
                    jsonStr: safeStringify(baseJson),
                    text: baseText,
                  };
                  // 进入编辑态后忽略第一次 TipTap onChange（结构规范化）
                  contentEditIgnoreFirstChangeRef.current = { noteId: note._id, ignore: true };
                }
                dispatch({
                  type: 'ENTER_CONTENT_EDIT',
                  original: getNoteTextForEditor(),
                  value: getNoteTextForEditor(),
                });
              }}
            >
              {(() => {
                const hasDraft =
                  draftMetaRef.current.noteId === note._id &&
                  draftMetaRef.current.dirty &&
                  !!contentJsonDraft;

                if (hasDraft) {
                  return <RichTextViewer value={contentJsonDraft} />;
                }

                return note.contentJson ? <RichTextViewer value={note.contentJson} /> : getNotePlainText();
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
                    className={styles.keywordEditInput}
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
                    className={styles.keyword}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setActiveKeywordIndex(idx); setTagEditValue(kw); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setActiveKeywordIndex(idx); setTagEditValue(kw); } }}
                  >
                    {kw}
                    <button
                      type="button"
                      className={styles.keywordDeleteBtn}
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
                      className={styles.keywordEditInput}
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
                      className={styles.keywordAddBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveKeywordIndex(addingIndex);
                        setTagEditValue('');
                      }}
                      aria-label="添加关键词"
                    >
                      <span className={styles.keywordAddIcon}>+</span>
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
                className={styles.noteEditCancel}
                onClick={() => {
                  dispatch({ type: 'CANCEL_CONTENT_EDIT', value: state.content.original });
                  // 取消：丢弃草稿，回到服务端内容
                  const plain = getNotePlainText();
                  const baseJson = note.contentJson ?? buildJsonFromPlain(plain);
                  const baseText = extractPlainTextFromJson(baseJson) || getNoteTextForEditor();
                  setContentJsonDraft(baseJson);
                  setContentTextDraft(baseText);
                  draftMetaRef.current = { noteId: note._id, dirty: false };
                  contentEditBaselineRef.current = {
                    noteId: note._id,
                    jsonStr: safeStringify(baseJson),
                    text: baseText,
                  };
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
      </div>
    </div>
  );
}



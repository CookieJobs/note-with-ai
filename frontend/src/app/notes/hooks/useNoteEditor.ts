import { useReducer, useRef, useEffect, useState } from 'react';
import { JSONContent } from '@tiptap/react';
import type { Note, UpdateNoteCommand } from './useNotes';
import { NoteWriteConflict } from './useNotes';
import { WORKSPACE_ANIM_DELAY_MS } from '../animationTimings';

export type EditorNote = Note;

interface UseNoteEditorProps {
  note: EditorNote;
  updateNote: (command: UpdateNoteCommand) => Promise<Note>;
  onContentEditingChange?: (id: string, isEditing: boolean) => void;
  draft?: { json: JSONContent; text: string; dirty: boolean };
  onDraftChange?: (id: string, draft: { json: JSONContent; text: string; dirty: boolean }) => void;
  isContentEditingActive?: boolean;
}

type State = {
  expanded: boolean;
  title: {
    isEditing: boolean;
    value: string;
    saving: boolean;
    error: string;
    conflictCurrentTitle: string | null;
  };
  content: {
    isEditing: boolean;
    value: string;
    original: string;
    draft: string | null;
    saving: boolean;
    error: string;
    conflictCurrentText: string | null;
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
  | { type: 'SAVE_TITLE_FAIL'; error: string; conflictCurrentTitle?: string }
  | { type: 'SYNC_TITLE_FROM_NOTE'; value: string }
  | { type: 'ENTER_CONTENT_EDIT'; original: string; value: string }
  | { type: 'CHANGE_CONTENT'; value: string }
  | { type: 'BLUR_CONTENT_EXIT' }
  | { type: 'CANCEL_CONTENT_EDIT'; value: string }
  | { type: 'SAVE_CONTENT_START' }
  | { type: 'SAVE_CONTENT_SUCCESS'; value: string }
  | { type: 'SAVE_CONTENT_FAIL'; error: string; conflictCurrentText?: string }
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
        title: { ...state.title, isEditing: true, value: action.value, saving: false, error: '', conflictCurrentTitle: null },
      };

    case 'CHANGE_TITLE':
      return { ...state, title: { ...state.title, value: action.value } };

    case 'CANCEL_TITLE_EDIT':
      return { ...state, title: { ...state.title, isEditing: false, value: action.value, saving: false, error: '', conflictCurrentTitle: null } };

    case 'SAVE_TITLE_START':
      return { ...state, title: { ...state.title, saving: true, error: '', conflictCurrentTitle: null } };

    case 'SAVE_TITLE_SUCCESS':
      return { ...state, title: { isEditing: false, value: action.value, saving: false, error: '', conflictCurrentTitle: null } };

    case 'SAVE_TITLE_FAIL':
      return {
        ...state,
        title: {
          ...state.title,
          saving: false,
          error: action.error,
          conflictCurrentTitle: action.conflictCurrentTitle ?? null,
        },
      };

    case 'SYNC_TITLE_FROM_NOTE':
      if (state.title.isEditing) return state;
      return { ...state, title: { ...state.title, value: action.value, error: '', conflictCurrentTitle: null } };

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
          conflictCurrentText: null,
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
        content: {
          ...state.content,
          isEditing: false,
          value: action.value,
          original: action.value,
          draft: null,
          error: '',
          conflictCurrentText: null,
        },
      };

    case 'SAVE_CONTENT_START':
      return { ...state, content: { ...state.content, saving: true, error: '', conflictCurrentText: null } };

    case 'SAVE_CONTENT_SUCCESS':
      return {
        ...state,
        content: {
          ...state.content,
          isEditing: false,
          saving: false,
          value: action.value,
          original: action.value,
          draft: null,
          error: '',
          conflictCurrentText: null,
        },
      };

    case 'SAVE_CONTENT_FAIL':
      return {
        ...state,
        content: {
          ...state.content,
          saving: false,
          error: action.error,
          conflictCurrentText: action.conflictCurrentText ?? null,
        },
      };

    case 'SYNC_CONTENT_FROM_NOTE':
      if (state.content.isEditing) return state;
      if (state.content.draft !== null) return state;
      return {
        ...state,
        content: { ...state.content, value: action.value, original: action.value, error: '', conflictCurrentText: null },
      };

    case 'SET_CAN_EXPAND':
      return { ...state, layout: { ...state.layout, canExpand: action.value } };

    case 'SET_MAX_HEIGHT':
      return { ...state, layout: { ...state.layout, maxHeight: action.value } };

    default:
      return state;
  }
}

function initState(note: EditorNote): State {
  return {
    expanded: false,
    title: { isEditing: false, value: note.title || '', saving: false, error: '', conflictCurrentTitle: null },
    content: {
      isEditing: false,
      value: note.content || '',
      original: note.content || '',
      draft: null,
      saving: false,
      error: '',
      conflictCurrentText: null,
    },
    layout: { canExpand: false, maxHeight: '' },
  };
}

type KeywordOperation =
  | { kind: 'edit'; originalValue: string; occurrence: number }
  | { kind: 'add' }
  | { kind: 'delete'; originalValue: string; occurrence: number };

function occurrenceAt(keywords: string[], index: number): number {
  return keywords.slice(0, index).filter((keyword) => keyword === keywords[index]).length;
}

function findKeywordOccurrence(keywords: string[], value: string, occurrence: number): number | null {
  let seen = 0;
  for (let index = 0; index < keywords.length; index += 1) {
    if (keywords[index] !== value) continue;
    if (seen === occurrence) return index;
    seen += 1;
  }
  return null;
}

function applyKeywordOperation(keywords: string[], operation: KeywordOperation, value: string): string[] | null {
  if (operation.kind === 'add') {
    return value ? [...keywords, value] : keywords;
  }

  const index = findKeywordOccurrence(keywords, operation.originalValue, operation.occurrence);
  if (index === null) return null;
  if (operation.kind === 'delete' || !value) {
    return [...keywords.slice(0, index), ...keywords.slice(index + 1)];
  }
  return [...keywords.slice(0, index), value, ...keywords.slice(index + 1)];
}

export function useNoteEditor({
  note,
  updateNote,
  onContentEditingChange,
  draft,
  onDraftChange,
  isContentEditingActive = false,
}: UseNoteEditorProps) {
  const [state, dispatch] = useReducer(reducer, note, initState);

  const [contentJsonDraft, setContentJsonDraft] = useState<JSONContent | null>(null);
  const [contentTextDraft, setContentTextDraft] = useState<string>('');
  const draftMetaRef = useRef<{ noteId: string | null; dirty: boolean }>({ noteId: null, dirty: false });
  const contentEditBaselineRef = useRef<{ noteId: string | null; jsonStr: string; text: string } | null>(null);
  const titleEditRevisionRef = useRef<number | null>(null);
  const titleRetryRevisionRef = useRef<number | null>(null);
  const contentEditRevisionRef = useRef<number | null>(null);
  const contentRetryRevisionRef = useRef<number | null>(null);
  const keywordEditRevisionRef = useRef<number | null>(null);
  const keywordRetryRevisionRef = useRef<number | null>(null);
  const keywordOperationRef = useRef<KeywordOperation | null>(null);
  const contentEditIgnoreFirstChangeRef = useRef<{ noteId: string | null; ignore: boolean }>({ noteId: null, ignore: false });
  const [contentSavedFlash, setContentSavedFlash] = useState(false);
  const contentSavedTimerRef = useRef<number | null>(null);
  const saveExitTimerRef = useRef<number | null>(null);

  const [activeKeywordIndex, setActiveKeywordIndex] = useState<number | null>(null);
  const [tagEditValue, setTagEditValue] = useState<string>('');
  const [keywordError, setKeywordError] = useState<string>('');
  const contentEditActiveAckRef = useRef(false);


  // Sync with props
  useEffect(() => {
    dispatch({ type: 'SYNC_TITLE_FROM_NOTE', value: note.title || '' });
  }, [note.title]);

  useEffect(() => {
    dispatch({ type: 'SYNC_CONTENT_FROM_NOTE', value: note.content || '' });
  }, [note.content]);

  useEffect(() => {
    const operation = keywordOperationRef.current;
    if (!operation || operation.kind === 'delete') return;
    if (operation.kind === 'add') {
      setActiveKeywordIndex((note.keywords || []).length);
      return;
    }
    const index = findKeywordOccurrence(note.keywords || [], operation.originalValue, operation.occurrence);
    if (index !== null) setActiveKeywordIndex(index);
  }, [note.keywords]);

  useEffect(() => {
    if (draft && draft.dirty && draft.json) {
      setContentJsonDraft(draft.json);
      setContentTextDraft(draft.text || '');
      draftMetaRef.current = { noteId: note._id, dirty: true };
      return;
    }

    if (draft && !draft.dirty && draftMetaRef.current.noteId === note._id) {
      draftMetaRef.current = { noteId: note._id, dirty: false };
    }
  }, [draft, note._id]);

  useEffect(() => {
    if (!state.content.isEditing) {
      contentEditActiveAckRef.current = false;
      return;
    }

    // 进入编辑态时，卡片本地 state 会先于页面层 activeEditor 更新。
    // 只有页面层明确接管过当前卡片的编辑态之后，才允许“外部关闭”把它收起。
    if (isContentEditingActive) {
      contentEditActiveAckRef.current = true;
      return;
    }

    if (!contentEditActiveAckRef.current) return;
    dispatch({ type: 'BLUR_CONTENT_EXIT' });
  }, [isContentEditingActive, state.content.isEditing]);

  useEffect(() => {
    onContentEditingChange?.(note._id, state.content.isEditing);
  }, [note._id, onContentEditingChange, state.content.isEditing]);

  useEffect(() => {
      return () => {
        if (contentSavedTimerRef.current) window.clearTimeout(contentSavedTimerRef.current);
        if (saveExitTimerRef.current) window.clearTimeout(saveExitTimerRef.current);
      };
  }, []);


  const getNotePlainText = () => {
    const t = note.contentText;
    if (typeof t === 'string' && t.trim().length > 0) return t;
    return note.content || '';
  };

  const buildJsonFromPlain = (text: string) => {
    if (!text) {
      return {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [],
          },
        ],
      };
    }

    // 将纯文本按换行符分割为多个段落，以保证兼容旧版单换行文本
    const lines = text.split('\n');
    return {
      type: 'doc',
      content: lines.map(line => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })),
    };
  };

  const safeStringify = (v: unknown) => {
    try {
      return JSON.stringify(v ?? null);
    } catch {
      return '';
    }
  };

  const extractPlainTextFromJson = (doc: JSONContent): string => {
    const out: string[] = [];
    const walk = (node: JSONContent) => {
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
    if (note.contentJson) {
      const t = extractPlainTextFromJson(note.contentJson);
      if (t) return t;
    }
    return getNotePlainText();
  };

  const beginTitleEdit = () => {
    titleEditRevisionRef.current = note.revision;
    titleRetryRevisionRef.current = null;
    dispatch({ type: 'ENTER_TITLE_EDIT', value: note.title || '' });
  };

  const handleSaveTitle = async () => {
    const next = state.title.value.trim();
    if (next === (note.title || '')) {
      dispatch({ type: 'CANCEL_TITLE_EDIT', value: note.title || '' });
      return;
    }

    dispatch({ type: 'SAVE_TITLE_START' });
    try {
      const updatedNote = await updateNote({
        noteId: note._id,
        expectedRevision: titleRetryRevisionRef.current ?? titleEditRevisionRef.current ?? note.revision,
        changes: { title: next },
      });
      dispatch({ type: 'SAVE_TITLE_SUCCESS', value: updatedNote.title ?? next });
      titleEditRevisionRef.current = null;
      titleRetryRevisionRef.current = null;
    } catch (error) {
      if (error instanceof NoteWriteConflict) {
        titleRetryRevisionRef.current = error.current.revision;
      }
      dispatch({
        type: 'SAVE_TITLE_FAIL',
        error: error instanceof NoteWriteConflict
          ? `笔记已被其他写入更新。本地标题已保留，当前服务端版本为 ${error.current.revision}。`
          : error instanceof Error ? error.message : '保存标题失败，请重试。',
        conflictCurrentTitle: error instanceof NoteWriteConflict ? error.current.title ?? '' : undefined,
      });
    }
  };

  const handleSaveContent = async () => {
    const valText = (contentTextDraft || '').trim();
    const prevText = getNotePlainText().trim();
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
      const updated = await updateNote({
        noteId: note._id,
        expectedRevision: contentRetryRevisionRef.current ?? contentEditRevisionRef.current ?? note.revision,
        changes: { body: { kind: 'rich-text', document: nextJson as Record<string, unknown> } },
      });
      const nextText = (updated.contentText ?? updated.content ?? contentTextDraft) as string;
      const updatedJson = updated.contentJson ?? contentJsonDraft;

      draftMetaRef.current = { noteId: note._id, dirty: false };
      onDraftChange?.(note._id, { json: updatedJson as JSONContent, text: nextText, dirty: false });
      contentEditRevisionRef.current = null;
      contentRetryRevisionRef.current = null;

      setContentSavedFlash(true);
      if (contentSavedTimerRef.current) window.clearTimeout(contentSavedTimerRef.current);
      contentSavedTimerRef.current = window.setTimeout(() => setContentSavedFlash(false), 2000);

      if (saveExitTimerRef.current) window.clearTimeout(saveExitTimerRef.current);
      saveExitTimerRef.current = window.setTimeout(() => {
        dispatch({ type: 'SAVE_CONTENT_SUCCESS', value: nextText });
        saveExitTimerRef.current = null;
      }, WORKSPACE_ANIM_DELAY_MS);
    } catch (e: unknown) {
      if (saveExitTimerRef.current) {
        window.clearTimeout(saveExitTimerRef.current);
        saveExitTimerRef.current = null;
      }
      const current = e instanceof NoteWriteConflict ? e.current : null;
      if (current) contentRetryRevisionRef.current = current.revision;
      dispatch({
        type: 'SAVE_CONTENT_FAIL',
        error: current
          ? `笔记已被其他写入更新。本地草稿已保留，当前服务端版本为 ${current.revision}。`
          : e instanceof Error ? e.message : '保存失败',
        conflictCurrentText: current
          ? typeof current.contentText === 'string' ? current.contentText : current.content
          : undefined,
      });
    }
  };

  const deleteKeywordAt = async (idx: number) => {
    const keywords = [...(note.keywords || [])];
    let operation = keywordOperationRef.current;
    if (!operation || operation.kind !== 'delete') {
      if (idx < 0 || idx >= keywords.length) return;
      operation = { kind: 'delete', originalValue: keywords[idx], occurrence: occurrenceAt(keywords, idx) };
      keywordOperationRef.current = operation;
      keywordEditRevisionRef.current = note.revision;
      keywordRetryRevisionRef.current = null;
    }
    const nextKeywords = applyKeywordOperation(keywords, operation, '');
    if (!nextKeywords) {
      setKeywordError('关键词已发生变化，请重新操作。');
      return;
    }
    setKeywordError('');

    try {
      await updateNote({
        noteId: note._id,
        expectedRevision: keywordRetryRevisionRef.current ?? keywordEditRevisionRef.current ?? note.revision,
        changes: { keywords: nextKeywords },
      });
      setActiveKeywordIndex(null);
      setTagEditValue('');
      setKeywordError('');
      keywordEditRevisionRef.current = null;
      keywordRetryRevisionRef.current = null;
      keywordOperationRef.current = null;
    } catch (error) {
      if (error instanceof NoteWriteConflict) keywordRetryRevisionRef.current = error.current.revision;
      setKeywordError(error instanceof NoteWriteConflict
        ? '关键词已被其他写入更新。本地编辑已保留，请重试。'
        : error instanceof Error ? error.message : '保存关键词失败，请重试。');
      setActiveKeywordIndex(null);
    }
  };

  const commitKeywordAt = async (idx: number) => {
    const v = tagEditValue.trim();
    const keywords = [...(note.keywords || [])];
    let operation = keywordOperationRef.current;
    if (!operation) {
      if (idx < keywords.length) {
        operation = { kind: 'edit', originalValue: keywords[idx], occurrence: occurrenceAt(keywords, idx) };
      } else if (idx === keywords.length) {
        operation = { kind: 'add' };
      } else {
        return;
      }
      keywordOperationRef.current = operation;
      keywordEditRevisionRef.current = note.revision;
      keywordRetryRevisionRef.current = null;
    }
    const nextKeywords = applyKeywordOperation(keywords, operation, v);
    if (!nextKeywords) {
      setKeywordError('关键词已发生变化，请重新操作。');
      return;
    }
    if (operation.kind === 'add' && !v) {
      setActiveKeywordIndex(null);
      setTagEditValue('');
      keywordOperationRef.current = null;
      return;
    }
    setKeywordError('');

    try {
      await updateNote({
        noteId: note._id,
        expectedRevision: keywordRetryRevisionRef.current ?? keywordEditRevisionRef.current ?? note.revision,
        changes: { keywords: nextKeywords },
      });
      setActiveKeywordIndex(null);
      setTagEditValue('');
      setKeywordError('');
      keywordEditRevisionRef.current = null;
      keywordRetryRevisionRef.current = null;
      keywordOperationRef.current = null;
    } catch (error) {
      if (error instanceof NoteWriteConflict) keywordRetryRevisionRef.current = error.current.revision;
      setKeywordError(error instanceof NoteWriteConflict
        ? '关键词已被其他写入更新。本地编辑已保留，请重试。'
        : error instanceof Error ? error.message : '保存关键词失败，请重试。');
    }
  };

  const beginKeywordEdit = (idx: number, value: string) => {
    const keywords = note.keywords || [];
    setKeywordError('');
    keywordEditRevisionRef.current = note.revision;
    keywordRetryRevisionRef.current = null;
    keywordOperationRef.current = idx < keywords.length
      ? { kind: 'edit', originalValue: keywords[idx], occurrence: occurrenceAt(keywords, idx) }
      : { kind: 'add' };
    setActiveKeywordIndex(idx);
    setTagEditValue(value);
  };

  const cancelKeywordEdit = () => {
    setKeywordError('');
    keywordEditRevisionRef.current = null;
    keywordRetryRevisionRef.current = null;
    keywordOperationRef.current = null;
    setActiveKeywordIndex(null);
    setTagEditValue('');
  };

  const enterContentEdit = (e?: React.MouseEvent) => {
    if (state.content.isEditing) return;

    const t = (e?.target ?? null) as Element | null;
    if (t) {
      if (t.closest('button, input, textarea, select, [role="button"]')) return;
      const a = t.closest('a');
      if (a) {
        if (e && (e.metaKey || e.ctrlKey)) return;
        e?.preventDefault();
      }
    }

    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && String(sel).trim().length > 0) {
      return;
    }

    if (draftMetaRef.current.noteId === note._id && draftMetaRef.current.dirty && contentJsonDraft) {
      // keep draft
    } else {
      const baseJson = note.contentJson ?? buildJsonFromPlain(getNotePlainText());
      const baseText = extractPlainTextFromJson(baseJson) || getNoteTextForEditor();
      setContentJsonDraft(baseJson);
      setContentTextDraft(baseText);
      draftMetaRef.current = { noteId: note._id, dirty: false };
      onDraftChange?.(note._id, { json: baseJson, text: baseText, dirty: false });
      contentEditBaselineRef.current = {
        noteId: note._id,
        jsonStr: safeStringify(baseJson),
        text: baseText,
      };
      contentEditRevisionRef.current = note.revision;
      contentRetryRevisionRef.current = null;
      contentEditIgnoreFirstChangeRef.current = { noteId: note._id, ignore: true };
    }

    dispatch({
      type: 'ENTER_CONTENT_EDIT',
      original: getNoteTextForEditor(),
      value: getNoteTextForEditor(),
    });
  };

  const onEditorChange = ({ json, text }: { json: JSONContent; text: string }) => {
    const jsonStr = safeStringify(json);
    const baseline = contentEditBaselineRef.current;
    
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
    onDraftChange?.(note._id, { json, text, dirty: true });
    if (contentSavedFlash) setContentSavedFlash(false);
    if (contentSavedTimerRef.current) {
      window.clearTimeout(contentSavedTimerRef.current);
      contentSavedTimerRef.current = null;
    }
    dispatch({ type: 'CHANGE_CONTENT', value: text });
  };

  const handleCancelContent = () => {
    dispatch({ type: 'CANCEL_CONTENT_EDIT', value: state.content.original });
    
    // Reset drafts to original content
    const baseJson = note.contentJson ?? buildJsonFromPlain(getNotePlainText());
    const baseText = extractPlainTextFromJson(baseJson) || getNoteTextForEditor();
    setContentJsonDraft(baseJson);
    setContentTextDraft(baseText);
    draftMetaRef.current = { noteId: note._id, dirty: false };
    onDraftChange?.(note._id, { json: baseJson, text: baseText, dirty: false });
    contentEditBaselineRef.current = {
      noteId: note._id,
      jsonStr: safeStringify(baseJson),
      text: baseText,
    };
  };

  return {
    state,
    dispatch,
    contentJsonDraft,
    contentTextDraft,
    contentSavedFlash,
    activeKeywordIndex,
    setActiveKeywordIndex,
    tagEditValue,
    setTagEditValue,
    keywordError,
    beginKeywordEdit,
    cancelKeywordEdit,
    handleSaveTitle,
    beginTitleEdit,
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
    safeStringify,
  };
}

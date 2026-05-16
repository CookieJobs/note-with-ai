import { useReducer, useRef, useEffect, useState, useCallback } from 'react';
import { JSONContent } from '@tiptap/react';
import { authFetch } from '../../../utils/auth';
import type { IRecommendCache, INote } from '../../../types';
import { WORKSPACE_ANIM_DELAY_MS } from '../animationTimings';

// Extend INote to support frontend-specific properties if needed, or just use INote
// For now, assuming INote is sufficient for data, but we need to handle 'enriching' if it's passed.
// Let's define a local type that matches what we expect
export interface EditorNote extends INote {
  enriching?: boolean;
}

interface UseNoteEditorProps {
  note: EditorNote;
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

function initState(note: EditorNote): State {
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

export function useNoteEditor({
  note,
  onUpdateTitle,
  onUpdateContent,
  onUpdateKeywords,
  onUpdateRecommendCache,
  onContentEditingChange,
  draft,
  onDraftChange,
  exitEditSignal,
}: UseNoteEditorProps) {
  const [state, dispatch] = useReducer(reducer, note, initState);

  const [contentJsonDraft, setContentJsonDraft] = useState<JSONContent | null>(null);
  const [contentTextDraft, setContentTextDraft] = useState<string>('');
  const draftMetaRef = useRef<{ noteId: string | null; dirty: boolean }>({ noteId: null, dirty: false });
  const contentEditBaselineRef = useRef<{ noteId: string | null; jsonStr: string; text: string } | null>(null);
  const contentEditIgnoreFirstChangeRef = useRef<{ noteId: string | null; ignore: boolean }>({ noteId: null, ignore: false });
  const [contentSavedFlash, setContentSavedFlash] = useState(false);
  const contentSavedTimerRef = useRef<number | null>(null);
  const saveExitTimerRef = useRef<number | null>(null);

  const [activeKeywordIndex, setActiveKeywordIndex] = useState<number | null>(null);
  const [tagEditValue, setTagEditValue] = useState<string>('');
  const lastExitSignalRef = useRef(exitEditSignal);
  const refreshRecCallRef = useRef(0);


  // Sync with props
  useEffect(() => {
    dispatch({ type: 'SYNC_TITLE_FROM_NOTE', value: note.title || '' });
  }, [note.title]);

  useEffect(() => {
    dispatch({ type: 'SYNC_CONTENT_FROM_NOTE', value: note.content || '' });
  }, [note.content]);

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
    if (exitEditSignal === lastExitSignalRef.current) return;
    lastExitSignalRef.current = exitEditSignal;
    if (!exitEditSignal) return;
    if (!state.content.isEditing) return;
    dispatch({ type: 'BLUR_CONTENT_EXIT' });
  }, [exitEditSignal, state.content.isEditing]);

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

  const buildRecommendCacheFromResponse = useCallback((
    noteUpdatedAt: string | undefined,
    payload: any
  ): IRecommendCache => {
    const data = payload?.data ?? {};
    const meta = data?.meta ?? {};
    const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];
    const generatedAt = new Date().toISOString();
    const byCandidateId: NonNullable<IRecommendCache['byCandidateId']> = recommendations.reduce((acc: NonNullable<IRecommendCache['byCandidateId']>, item: any) => {
      const candidateId = String(item?.note?._id || '');
      if (!candidateId) return acc;
      acc[candidateId] = {
        s1: Number(item?.s1 || 0),
        s2: Number(item?.s2 || 0),
        type: typeof item?.type === 'string' ? item.type : '',
        reason: typeof item?.reason === 'string' ? item.reason : '',
        candidateUpdatedAt: String(item?.note?.updatedAt || ''),
        cachedAt: generatedAt,
      };
      return acc;
    }, {});

    return {
      algoVersion: typeof meta?.algoVersion === 'string' ? meta.algoVersion : 'semantic-notes-v3',
      sourceUpdatedAt: noteUpdatedAt,
      generatedAt,
      params: meta?.thresholds,
      diagnostics: meta?.diagnostics,
      byCandidateId,
    };
  }, []);

  const refreshRecommendCache = useCallback(async (noteId: string, noteUpdatedAt?: string) => {
    if (!onUpdateRecommendCache) return;

    const callTime = Date.now();
    refreshRecCallRef.current = callTime;

    try {
      const response = await authFetch('/api/recommend/semantic-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          writeMode: 'await',
        }),
      });
      // 丢弃非最新请求的响应，防止并发写入互相覆盖
      if (callTime !== refreshRecCallRef.current) return;
      const payload = await response.json();
      if (!response.ok) return;

      onUpdateRecommendCache(noteId, buildRecommendCacheFromResponse(noteUpdatedAt, payload));
    } catch {
      // 推荐缓存补算失败不应影响正文保存体验
    }
  }, [buildRecommendCacheFromResponse, onUpdateRecommendCache]);

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
      const data = await response.json();

      if (!response.ok) throw new Error('保存标题失败');

      const updatedNote = data?.data?.note;
      onUpdateTitle(note._id, next, updatedNote?.updatedAt);
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
    const prevLen = prevText.length;
    const nextLen = valText.length;
    const deltaRatio = Math.abs(nextLen - prevLen) / Math.max(prevLen, 1);
    const shouldSummaryCheck = deltaRatio > 0.3;

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
          ...(shouldSummaryCheck ? { summaryCheck: true } : {}),
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
            draftMetaRef.current = { noteId: note._id, dirty: false };
            onDraftChange?.(note._id, { json: serverJson ?? null, text: serverText, dirty: false });
            
            setContentSavedFlash(true);
            if (contentSavedTimerRef.current) window.clearTimeout(contentSavedTimerRef.current);
            contentSavedTimerRef.current = window.setTimeout(() => setContentSavedFlash(false), 2000);
            
            if (saveExitTimerRef.current) window.clearTimeout(saveExitTimerRef.current);
            saveExitTimerRef.current = window.setTimeout(() => {
              dispatch({ type: 'SAVE_CONTENT_SUCCESS', value: serverText });
              saveExitTimerRef.current = null;
            }, WORKSPACE_ANIM_DELAY_MS);
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
        
        authFetch(`/api/notes/${note._id}/embed`, { method: 'POST' })
          .then((r) => r.json())
          .then((embedData) => {
            const emb = embedData?.data?.embedding;
            if (Array.isArray(emb) && emb.length > 0) {
              onUpdateContent(note._id, nextText, updated.updatedAt, nextJson, updated.contentText, emb);
            }
          })
          .catch(() => {});

        void refreshRecommendCache(note._id, updated.updatedAt);
        
        draftMetaRef.current = { noteId: note._id, dirty: false };
        onDraftChange?.(note._id, { json: nextJson ?? null, text: nextText, dirty: false });

        setContentSavedFlash(true);
        if (contentSavedTimerRef.current) window.clearTimeout(contentSavedTimerRef.current);
        contentSavedTimerRef.current = window.setTimeout(() => setContentSavedFlash(false), 2000);

        if (saveExitTimerRef.current) window.clearTimeout(saveExitTimerRef.current);
        saveExitTimerRef.current = window.setTimeout(() => {
          dispatch({ type: 'SAVE_CONTENT_SUCCESS', value: nextText });
          saveExitTimerRef.current = null;
        }, WORKSPACE_ANIM_DELAY_MS);
      }
    } catch (e: unknown) {
      if (saveExitTimerRef.current) {
        window.clearTimeout(saveExitTimerRef.current);
        saveExitTimerRef.current = null;
      }
      dispatch({ type: 'SAVE_CONTENT_FAIL', error: e instanceof Error ? e.message : '保存失败' });
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
      // ignore
    } finally {
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
    safeStringify,
  };
}

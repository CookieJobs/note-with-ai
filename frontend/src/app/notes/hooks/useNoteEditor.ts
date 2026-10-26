import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import type { Note, UpdateNoteCommand } from './useNotes';
import { NoteWriteConflict } from './useNotes';
import { validateNoteTitle } from '../utils/titleValidation';

export type NoteEditDraft = {
  title: string;
  json: JSONContent;
  text: string;
  dirty: boolean;
  baseline: { title: string; json: JSONContent; text: string; revision: number };
};
type Props = {
  note: Note;
  userId?: string | null;
  updateNote: (command: UpdateNoteCommand) => Promise<Note>;
  onContentEditingChange?: (id: string, isEditing: boolean) => void;
  draft?: NoteEditDraft;
  onDraftChange?: (id: string, draft: NoteEditDraft | null) => void;
  isContentEditingActive?: boolean;
};
type State = {
  expanded: boolean;
  title: { isEditing: boolean; value: string; saving: boolean; error: string; conflictCurrentTitle: string | null };
  content: { isEditing: boolean; value: string; original: string; draft: string | null; saving: boolean; error: string; conflictCurrentText: string | null };
  layout: { canExpand: boolean; maxHeight: string };
};
type Action =
  | { type: 'CHANGE_TITLE'; value: string }
  | { type: 'TOGGLE_EXPANDED' }
  | { type: 'SET_EXPANDED'; value: boolean }
  | { type: 'SET_CAN_EXPAND'; value: boolean }
  | { type: 'SET_MAX_HEIGHT'; value: string }
  | { type: 'BLUR_CONTENT_EXIT' }
  | { type: 'BLUR_TITLE_EXIT' };

const fromPlain = (text: string): JSONContent => ({ type: 'doc', content: text.split('\n').map((line) => ({
  type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [],
})) });
const noteText = (note: Note) => note.contentText ?? note.content ?? '';
const noteJson = (note: Note) => (note.contentJson as JSONContent | null) ?? fromPlain(noteText(note));
const makeDraft = (note: Note): NoteEditDraft => {
  const title = note.title ?? '';
  const text = noteText(note);
  const json = noteJson(note);
  return { title, text, json, dirty: false, baseline: { title, text, json, revision: note.revision } };
};
const bodyDirty = (draft: NoteEditDraft) => draft.text !== draft.baseline.text
  || JSON.stringify(draft.json) !== JSON.stringify(draft.baseline.json);
const titleDirty = (draft: NoteEditDraft) => draft.title.trim() !== draft.baseline.title.trim();
const withDirty = (draft: NoteEditDraft) => ({ ...draft, dirty: bodyDirty(draft) || titleDirty(draft) });

export function useNoteEditor({ note, userId = null, updateNote, onContentEditingChange, draft, onDraftChange,
  isContentEditingActive = false }: Props) {
  const [state, setState] = useState<State>(() => ({
    expanded: false,
    title: { isEditing: false, value: draft?.title ?? note.title ?? '', saving: false, error: '', conflictCurrentTitle: null },
    content: { isEditing: false, value: draft?.text ?? noteText(note), original: noteText(note), draft: null, saving: false, error: '', conflictCurrentText: null },
    layout: { canExpand: false, maxHeight: '' },
  }));
  const [contentJsonDraft, setContentJsonDraft] = useState<JSONContent | null>(draft?.json ?? null);
  const [contentTextDraft, setContentTextDraft] = useState(draft?.text ?? '');
  const [contentSavedFlash, setContentSavedFlash] = useState(false);
  const sessionRef = useRef<NoteEditDraft>(draft ?? makeDraft(note));
  const noteRef = useRef(note);
  noteRef.current = note;
  const saveRef = useRef(false);
  const activeAck = useRef(false);
  const sessionEpoch = useRef(0);
  const owner = `${userId ?? ''}:${note._id}`;
  const ownerRef = useRef(owner);
  const mountedRef = useRef(true);
  if (ownerRef.current !== owner) {
    ownerRef.current = owner;
    sessionEpoch.current += 1;
    sessionRef.current = makeDraft(note);
  }
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; sessionEpoch.current += 1; };
  }, []);

  const emit = useCallback((next: NoteEditDraft) => {
    sessionRef.current = withDirty(next);
    onDraftChange?.(note._id, sessionRef.current.dirty ? sessionRef.current : null);
  }, [note._id, onDraftChange]);

  useEffect(() => {
    if (saveRef.current) return;
    if (sessionRef.current.dirty) {
      const current = sessionRef.current;
      if (current.baseline.revision === note.revision) return;
      const refreshed = makeDraft(note);
      const next = withDirty({
        ...current,
        title: titleDirty(current) ? current.title : refreshed.title,
        text: bodyDirty(current) ? current.text : refreshed.text,
        json: bodyDirty(current) ? current.json : refreshed.json,
        baseline: { ...current.baseline,
          title: titleDirty(current) ? current.baseline.title : refreshed.title,
          text: bodyDirty(current) ? current.baseline.text : refreshed.text,
          json: bodyDirty(current) ? current.baseline.json : refreshed.json,
        },
      });
      sessionRef.current = next;
      setContentJsonDraft(next.json);
      setContentTextDraft(next.text);
      onDraftChange?.(note._id, next);
      setState((old) => ({ ...old,
        title: { ...old.title, value: next.title },
        content: { ...old.content, value: next.text },
      }));
      return;
    }
    const clean = makeDraft(note);
    sessionRef.current = clean;
    setContentJsonDraft(clean.json);
    setContentTextDraft(clean.text);
    setState((current) => ({ ...current,
      title: { ...current.title, value: clean.title },
      content: { ...current.content, value: clean.text, original: clean.text },
    }));
  }, [note.revision, note.title, note.content, note.contentText, note.contentJson]);

  useEffect(() => {
    if (!state.content.isEditing) { activeAck.current = false; return; }
    if (isContentEditingActive) { activeAck.current = true; return; }
    if (activeAck.current) setState((current) => ({ ...current,
      title: { ...current.title, isEditing: false }, content: { ...current.content, isEditing: false } }));
  }, [isContentEditingActive, state.content.isEditing]);
  useEffect(() => { onContentEditingChange?.(note._id, state.content.isEditing); }, [note._id, onContentEditingChange, state.content.isEditing]);

  const changeTitle = useCallback((value: string) => {
    emit({ ...sessionRef.current, title: value });
    setState((current) => ({ ...current, title: { ...current.title, value, error: '', conflictCurrentTitle: null } }));
  }, [emit]);
  const dispatch = useCallback((action: Action) => {
    if (action.type === 'CHANGE_TITLE') { changeTitle(action.value); return; }
    setState((current) => {
      switch (action.type) {
        case 'TOGGLE_EXPANDED': return { ...current, expanded: !current.expanded };
        case 'SET_EXPANDED': return { ...current, expanded: action.value };
        case 'SET_CAN_EXPAND': return { ...current, layout: { ...current.layout, canExpand: action.value } };
        case 'SET_MAX_HEIGHT': return { ...current, layout: { ...current.layout, maxHeight: action.value } };
        case 'BLUR_CONTENT_EXIT': return { ...current,
          title: { ...current.title, isEditing: false }, content: { ...current.content, isEditing: false } };
        case 'BLUR_TITLE_EXIT': return { ...current, title: { ...current.title, isEditing: false } };
      }
    });
  }, [changeTitle]);

  const beginTitleEdit = () => {
    const draft = sessionRef.current;
    setContentJsonDraft(draft.json);
    setContentTextDraft(draft.text);
    setState((current) => ({ ...current,
      title: { ...current.title, isEditing: true, error: '', conflictCurrentTitle: null },
      content: { ...current.content, isEditing: true, value: draft.text, error: '' },
      layout: { ...current.layout, canExpand: false },
    }));
  };
  const enterContentEdit = (event?: React.MouseEvent) => {
    const target = event?.target as Element | undefined;
    if (target?.closest('button, input, textarea, select, [role="button"]')) return;
    if (target?.closest('a')) { if (event?.metaKey || event?.ctrlKey) return; event?.preventDefault(); }
    if (state.content.isEditing) return;
    const current = sessionRef.current;
    setContentJsonDraft(current.json);
    setContentTextDraft(current.text);
    setState((old) => ({ ...old, content: { ...old.content, isEditing: true, value: current.text, error: '' },
      layout: { ...old.layout, canExpand: false } }));
  };
  const onEditorChange = ({ json, text }: { json: JSONContent; text: string }) => {
    const current = sessionRef.current;
    if (current.text === text && JSON.stringify(current.json) === JSON.stringify(json)) return;
    emit({ ...current, json, text });
    setContentJsonDraft(json);
    setContentTextDraft(text);
    setContentSavedFlash(false);
    setState((old) => ({ ...old, content: { ...old.content, value: text, draft: text, error: '' } }));
  };

  const cancel = () => {
    sessionEpoch.current += 1;
    const clean = makeDraft(noteRef.current);
    sessionRef.current = clean;
    onDraftChange?.(note._id, null);
    setContentJsonDraft(clean.json);
    setContentTextDraft(clean.text);
    setState((current) => ({ ...current,
      title: { isEditing: false, value: clean.title, saving: false, error: '', conflictCurrentTitle: null },
      content: { isEditing: false, value: clean.text, original: clean.text, draft: null, saving: false, error: '', conflictCurrentText: null },
    }));
  };

  const save = async (): Promise<boolean> => {
    if (saveRef.current) return false;
    const snapshot = sessionRef.current;
    const titleError = titleDirty(snapshot) ? validateNoteTitle(snapshot.title) : null;
    if (titleError) {
      setState((old) => ({ ...old, title: { ...old.title, error: titleError } }));
      return false;
    }
    const changes: UpdateNoteCommand['changes'] = {};
    if (titleDirty(snapshot)) changes.title = snapshot.title.trim();
    if (bodyDirty(snapshot)) changes.body = { kind: 'rich-text', document: snapshot.json as Record<string, unknown> };
    if (!Object.keys(changes).length) {
      setState((current) => ({ ...current, title: { ...current.title, isEditing: false }, content: { ...current.content, isEditing: false } }));
      return false;
    }
    saveRef.current = true;
    const submittedOwner = ownerRef.current;
    const submittedEpoch = sessionEpoch.current;
    setState((current) => ({ ...current,
      title: { ...current.title, saving: true, error: '', conflictCurrentTitle: null },
      content: { ...current.content, saving: true, error: '', conflictCurrentText: null },
    }));
    try {
      const accepted = await updateNote({ noteId: note._id, expectedRevision: snapshot.baseline.revision, changes });
      if (!mountedRef.current || ownerRef.current !== submittedOwner) return false;
      const current = sessionRef.current;
      const wasCanceled = sessionEpoch.current !== submittedEpoch;
      const acceptedBaseline = {
        title: accepted.title ?? (changes.title ?? snapshot.baseline.title),
        text: accepted.contentText ?? (changes.body ? snapshot.text : snapshot.baseline.text),
        json: accepted.contentJson ? accepted.contentJson as JSONContent : changes.body ? snapshot.json : snapshot.baseline.json,
        revision: accepted.revision,
      };
      const titleUnchanged = current.title === snapshot.title;
      const bodyUnchanged = current.text === snapshot.text && JSON.stringify(current.json) === JSON.stringify(snapshot.json);
      const next = withDirty({ ...current,
        title: (!wasCanceled && titleUnchanged) || (wasCanceled && !titleDirty(current)) ? acceptedBaseline.title : current.title,
        text: (!wasCanceled && bodyUnchanged) || (wasCanceled && !bodyDirty(current)) ? acceptedBaseline.text : current.text,
        json: (!wasCanceled && bodyUnchanged) || (wasCanceled && !bodyDirty(current)) ? acceptedBaseline.json : current.json,
        baseline: acceptedBaseline,
      });
      sessionRef.current = next;
      onDraftChange?.(note._id, next.dirty ? next : null);
      setContentJsonDraft(next.json);
      setContentTextDraft(next.text);
      setContentSavedFlash(!wasCanceled);
      setState((old) => ({ ...old,
        title: { ...old.title, value: next.title, isEditing: next.dirty ? old.title.isEditing : false, saving: false, error: '', conflictCurrentTitle: null },
        content: { ...old.content, value: next.text, isEditing: next.dirty ? old.content.isEditing : false, saving: false, error: '', conflictCurrentText: null },
      }));
      return !wasCanceled && !next.dirty;
    } catch (error) {
      if (!mountedRef.current || ownerRef.current !== submittedOwner || sessionEpoch.current !== submittedEpoch) return false;
      const current = error instanceof NoteWriteConflict ? error.current : null;
      if (current) {
        sessionRef.current = { ...sessionRef.current,
          baseline: { ...sessionRef.current.baseline, revision: current.revision } };
        onDraftChange?.(note._id, sessionRef.current);
      }
      const message = current ? `笔记已被其他写入更新。本地草稿已保留，当前服务端版本为 ${current.revision}。`
        : error instanceof Error ? error.message : '保存失败，请重试。';
      setState((old) => ({ ...old,
        title: { ...old.title, saving: false, error: message, conflictCurrentTitle: current?.title ?? null },
        content: { ...old.content, saving: false, error: message, conflictCurrentText: current?.contentText ?? current?.content ?? null },
      }));
      return false;
    } finally { saveRef.current = false; }
  };

  return { state, dispatch, contentJsonDraft, contentTextDraft, contentSavedFlash,
    isDirty: () => sessionRef.current.dirty, isSaving: () => saveRef.current,
    beginTitleEdit, changeTitle, handleSaveTitle: save, handleSaveContent: save,
    handleCancelContent: cancel, cancel, enterContentEdit, onEditorChange,
    getNotePlainText: () => noteText(note), getNoteTextForEditor: () => noteText(note),
    buildJsonFromPlain: fromPlain,
  };
}

/*
Input: 已保存笔记或新建命令、工作区保护接口、真实编辑和草稿 hooks
Output: 按需加载的 Tiptap 编辑会话；仅确认当前草稿保存成功时退出
Pos: notes/components；修改时同步 ../README.md
*/
'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/react';
import { Bold, Italic, Heading2, List, ListOrdered, ListTodo, Quote, Code2, Table2, Strikethrough } from 'lucide-react';
import { useWorkspace } from '../../../components/workspace/WorkspaceContext';
import type { WorkspaceEditor } from '../../../components/workspace/WorkspaceContext';
import { useNoteTitleSuggestion } from '../../../hooks/useNoteTitleSuggestion';
import { useNoteEditor } from '../hooks/useNoteEditor';
import { useCreateNote } from '../hooks/useCreateNote';
import type { CreateNoteCommand, Note, UpdateNoteCommand } from '../hooks/useNotes';
import { hasTitleSourceText } from '../utils/titleValidation';
import NoteTitleField from './NoteTitleField';
import RichTextEditor from './RichTextEditor';
import { focusProseMirrorWithin } from './focusProseMirror';
import styles from '../NotesWorkspace.module.scss';

type Common = { userId: string | null; onSaved: () => void; onCancel: () => void };
type Props = Common & (
  | { mode: 'edit'; note: Note; updateNote: (command: UpdateNoteCommand) => Promise<Note> }
  | { mode: 'compose'; createNote: (command: CreateNoteCommand) => Promise<Note> }
);
type Session = {
  title: string; json: JSONContent; text: string; error: string; status?: string; saving: boolean;
  changeTitle: (value: string) => void;
  changeBody: (value: { json: JSONContent; text: string }) => void;
  isDirty: () => boolean; isSaving: () => boolean;
  save: () => Promise<boolean>; discard: () => boolean | void;
};
const fromPlain = (text: string): JSONContent => ({ type: 'doc', content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) });

function FormattingToolbar({ editor }: { editor: Editor | null }) {
  const [, refresh] = useReducer((version) => version + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', refresh);
    return () => { editor.off('transaction', refresh); };
  }, [editor]);
  if (!editor) return null;
  const commands = [
    { label: '加粗', icon: Bold, active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: '删除线', icon: Strikethrough, active: editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
    { label: '二级标题', icon: Heading2, active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: '无序列表', icon: List, active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: ListOrdered, active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '任务列表', icon: ListTodo, active: editor.isActive('taskList'), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: '引用', icon: Quote, active: editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '代码块', icon: Code2, active: editor.isActive('codeBlock'), run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: '插入表格', icon: Table2, active: editor.isActive('table'), run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ];
  return <div className={styles.formatToolbar} role="toolbar" aria-label="笔记格式">
    {commands.map(({ label, icon: Icon, active, run }) => <button type="button" key={label} aria-label={label} title={label} aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()} onClick={run}><Icon size={16} /></button>)}
    <span>输入 / 插入更多</span>
  </div>;
}

function EditorForm({ session, sessionId, userId, onSaved, onCancel }: Common & { session: Session; sessionId: string }) {
  const workspace = useWorkspace();
  const rootRef = useRef<HTMLDivElement>(null);
  const [tiptapEditor, setTiptapEditor] = useState<Editor | null>(null);
  const latest = useRef({ session, onSaved, onCancel, workspace });
  latest.current = { session, onSaved, onCancel, workspace };
  const suggestion = useNoteTitleSuggestion({
    userId, editorSessionId: sessionId, open: true,
    getBody: () => ({ kind: 'rich-text', document: latest.current.session.json as Record<string, unknown> }),
    getTitle: () => latest.current.session.title,
    onApply: (title) => latest.current.session.changeTitle(title),
  });
  const invalidate = suggestion.invalidate;
  const save = useCallback(async () => {
    invalidate();
    const saved = await latest.current.session.save();
    // The guard owns its target action; the explicit button owns returning to reading.
    return saved;
  }, [invalidate]);
  const saveAndRead = useCallback(async () => {
    if (sessionId !== 'compose' && !latest.current.session.isDirty() && !latest.current.session.isSaving()) {
      invalidate(); latest.current.onSaved(); return;
    }
    if (await save()) latest.current.onSaved();
  }, [save, sessionId, invalidate]);
  const registerEditor = workspace?.registerEditor;
  useEffect(() => {
    const editor: WorkspaceEditor = {
      isDirty: () => latest.current.session.isDirty(),
      isSaving: () => latest.current.session.isSaving(),
      save,
      discard: () => { invalidate(); return latest.current.session.discard(); },
      focus: () => { focusProseMirrorWithin(rootRef.current); },
    };
    return registerEditor?.(editor);
  }, [registerEditor, save, invalidate]);

  const cancel = () => {
    const action = () => {
      invalidate();
      if (latest.current.session.discard() !== false) latest.current.onCancel();
    };
    if (workspace) workspace.requestAction(action); else action();
  };
  return (
    <div className={styles.editor} ref={rootRef} aria-label="笔记编辑" data-note-editor-inside="true"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      }}>
      <div className={styles.editorTop}><span>{sessionId === 'compose' ? '新建笔记' : '编辑笔记'}</span><span>修改后请保存</span></div>
      <NoteTitleField value={session.title}
        onChange={(value) => { suggestion.invalidate('title'); session.changeTitle(value); }}
        suggestion={suggestion} hasBodyText={hasTitleSourceText(session.json, session.text)} saving={session.saving}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Enter') return;
          event.preventDefault();
          if (event.metaKey || event.ctrlKey) void saveAndRead();
          else focusProseMirrorWithin(rootRef.current);
        }} />
      <FormattingToolbar editor={tiptapEditor} />
      <div className={styles.editorBody}>
        <RichTextEditor value={session.json} onChange={(value) => { suggestion.invalidate('body'); session.changeBody(value); }}
          placeholder="此刻在想什么？" showToolbar autoFocus="end" onEditorReady={setTiptapEditor} onModEnter={() => void saveAndRead()} />
      </div>
      {session.error && <p className={styles.error} role="alert">{session.error}</p>}
      {session.status && !session.error && <p className={styles.status} role="status">{session.status}</p>}
      <div className={styles.editorActions}>
        <span>⌘ / Ctrl + Enter 保存</span>
        <button type="button" className={styles.button} onClick={cancel} disabled={session.saving}>取消</button>
        <button type="button" className={styles.primaryButton} disabled={session.saving || (sessionId === 'compose' && !session.text.trim())} onClick={() => void saveAndRead()}>{session.saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  );
}

function ExistingEditor(props: Extract<Props, { mode: 'edit' }>) {
  const editor = useNoteEditor({ note: props.note, userId: props.userId, updateNote: props.updateNote, isContentEditingActive: true });
  // The shell remains mounted until its owner has acknowledged save/cancel.
  useEffect(() => { editor.enterContentEdit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <EditorForm {...props} sessionId={props.note._id} session={{
    title: editor.state.title.value, json: editor.contentJsonDraft ?? fromPlain(props.note.contentText ?? props.note.content ?? ''),
    text: editor.contentTextDraft, error: editor.state.title.error || editor.state.content.error,
    saving: editor.state.content.saving, changeTitle: editor.changeTitle, changeBody: editor.onEditorChange,
    isDirty: editor.isDirty, isSaving: editor.isSaving, save: editor.handleSaveContent,
    discard: () => { if (editor.isSaving()) return false; editor.cancel(); return true; },
  }} />;
}

function ComposeEditor(props: Extract<Props, { mode: 'compose' }>) {
  const capture = useCreateNote(props.createNote, { userId: props.userId });
  const live = useRef(capture);
  live.current = capture;
  // These refs also cover the acknowledgement microtask before React publishes the cleared draft.
  const draft = useRef({ title: capture.newTitle, text: capture.newContentText });
  draft.current = { title: capture.newTitle, text: capture.newContentText };
  const saving = useRef(false);
  return <EditorForm {...props} sessionId="compose" session={{
    title: capture.newTitle, json: capture.newContentJson ?? fromPlain(capture.newContentText), text: capture.newContentText,
    error: capture.saveError, status: capture.draftRestored ? '已恢复上次未保存的草稿。' : capture.localDraftState === 'saved' ? '草稿已保存在此浏览器' : '',
    saving: capture.loading,
    changeTitle: (title) => { draft.current.title = title; capture.setNewTitle(title); },
    changeBody: (value) => { draft.current.text = value.text; capture.changeContent(value); },
    isDirty: () => Boolean(draft.current.title.trim() || draft.current.text.trim()),
    // All creation saves enter through this session. The ref acknowledges the
    // settled request synchronously, before React commits capture.loading=false.
    isSaving: () => saving.current,
    save: async () => {
      if (saving.current) return false;
      saving.current = true;
      try {
        const accepted = await live.current.handleSubmit();
        if (accepted) draft.current = { title: '', text: '' };
        return accepted;
      } finally { saving.current = false; }
    },
    discard: () => {
      const removed = capture.discardDraft();
      if (removed) draft.current = { title: '', text: '' };
      return removed;
    },
  }} />;
}

export default function NoteWorkspaceEditor(props: Props) {
  return props.mode === 'edit' ? <ExistingEditor {...props} /> : <ComposeEditor {...props} />;
}

/*
Input: 真实游标笔记列表、highlight 单篇来源、新建意图与持久工作区
Output: 分离的列表 / 阅读 / Tiptap 编辑流程；成功查询才登记最近记录，替换动作经过工作区保护
Pos: notes 页面入口；修改时同步 ./README.md
*/
'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import dynamicComponent from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, PencilLine, Plus } from 'lucide-react';
import { getUser, isAuthenticated } from '../../utils/auth';
import { noteReferenceDisplay } from '../../utils/noteReference';
import { startNoteConversation } from '../../services/noteConversation';
import { useWorkspace } from '../../components/workspace/WorkspaceContext';
import { useAuthGuard } from './hooks/useAuthGuard';
import { NoteWriteConflict, useNotes } from './hooks/useNotes';
import type { CreateNoteCommand, Note } from './hooks/useNotes';
import { useFocusedSourceNote } from './hooks/useFocusedSourceNote';
import styles from './NotesWorkspace.module.scss';

const NoteWorkspaceReader = dynamicComponent(() => import('./components/NoteWorkspaceReader'), { ssr: false, loading: () => <p role="status">正在加载阅读视图…</p> });
const NoteWorkspaceEditor = dynamicComponent(() => import('./components/NoteWorkspaceEditor'), { ssr: false, loading: () => <p role="status">正在加载编辑器…</p> });
const RelatedNotesDrawer = dynamicComponent(() => import('./components/RelatedNotesDrawer'), { ssr: false });

export const dynamic = 'force-dynamic';

function creationGroup(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更早的记录';
  const today = new Date();
  const sameDay = (other: Date) => other.getFullYear() === date.getFullYear() && other.getMonth() === date.getMonth() && other.getDate() === date.getDate();
  if (sameDay(today)) return '今天';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (sameDay(yesterday)) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(date);
}

function NotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspace = useWorkspace();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [relatedId, setRelatedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [discussing, setDiscussing] = useState(false);
  const [discussionError, setDiscussionError] = useState('');
  const discussionRequest = useRef<object | null>(null);
  const latestDiscussion = useRef<object | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const deleteRef = useRef<HTMLDivElement>(null);
  const deleteReturnFocus = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const createdNote = useRef<Note | null>(null);
  const user = useAuthGuard({ isAuthenticated, getUser, routerPush: router.push, redirectTo: '/auth' });
  const { notes, isLoading, isSuccess, deleteNote, createNote, updateNote, refreshRecommendCache, refetchNotes,
    loadMoreNotes, hasMoreNotes, isLoadingMore, loadMoreError } = useNotes(user, { onError: setError });
  const highlightId = searchParams.get('highlight') || '';
  const composeIntent = searchParams.get('compose') === '1';
  // The URL owns this view so ordinary workspace navigation and history traversal
  // can leave it without relying on an unrelated highlight change.
  const compose = composeIntent && !highlightId && Boolean(user?.id);
  const focused = useFocusedSourceNote(user?.id ?? null, highlightId, notes.some((note) => note._id === highlightId));
  const focusedNote = focused.state?.status === 'ready' ? focused.state.note : undefined;
  const { captureMutation, applyCanonical, applyRecommendCache } = focused;
  const currentNote = notes.find((note) => note._id === highlightId) ?? focusedNote;
  const detail = Boolean(highlightId) || compose;
  const discussionOwner = useRef({ userId: user?.id, noteId: highlightId });
  if (discussionOwner.current.userId !== user?.id || discussionOwner.current.noteId !== highlightId) {
    // Returning to the same IDs starts a new source session, never reviving old work.
    discussionOwner.current = { userId: user?.id, noteId: highlightId };
  }
  const requestAction = workspace?.requestAction;
  const actSafely = useCallback((action: () => void) => { if (requestAction) requestAction(action); else action(); }, [requestAction]);
  const go = useCallback((href: string) => {
    actSafely(() => { setEditing(null); setRelatedId(null); router.push(href, { scroll: false }); });
  }, [actSafely, router]);
  const openNote = useCallback((id: string) => {
    listScroll.current = listRef.current?.scrollTop ?? listScroll.current;
    go('/notes?highlight=' + encodeURIComponent(id));
  }, [go]);
  const discuss = async (note: Note) => {
    if (discussionRequest.current || !user?.id) return;
    const request = {};
    const owner = discussionOwner.current;
    discussionRequest.current = request;
    latestDiscussion.current = request;
    setDiscussing(true); setDiscussionError('');
    const isCurrent = () => active.current && latestDiscussion.current === request && discussionOwner.current === owner && owner.noteId === note._id;
    try {
      const sessionId = await startNoteConversation(note._id, note.title);
      // The person may have entered editing while binding was in flight.
      if (isCurrent()) actSafely(() => { if (isCurrent()) router.push('/chat?session=' + encodeURIComponent(sessionId)); });
    } catch (failure) {
      if (isCurrent()) setDiscussionError('未能开始对话：' + (failure instanceof Error ? failure.message : '请稍后重试。'));
    } finally {
      if (discussionRequest.current === request) { discussionRequest.current = null; if (active.current) setDiscussing(false); }
    }
  };
  useEffect(() => {
    if (!compose) return;
    setEditing(null); setRelatedId(null); createdNote.current = null;
  }, [compose]);
  useEffect(() => {
    setEditing(null); setRelatedId(null);
    setDiscussionError('');
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, [highlightId]);
  useEffect(() => {
    if (!detail && listRef.current) listRef.current.scrollTop = listScroll.current;
  }, [detail]);
  const lastUser = useRef(user?.id);
  useEffect(() => {
    if (lastUser.current === user?.id) return;
    const previousUser = lastUser.current;
    lastUser.current = user?.id;
    if (previousUser) { setEditing(null); setRelatedId(null); createdNote.current = null; }
  }, [user?.id]);

  const setRecentNotes = workspace?.setRecentNotes;
  useEffect(() => {
    // An initial/failed [] is not a confirmed empty library and must not replace a trusted projection.
    if (!user?.id || !isSuccess) return;
    setRecentNotes?.(notes.slice(0, 5).map((note) => ({ id: note._id, title: noteReferenceDisplay(note).label, href: '/notes?highlight=' + encodeURIComponent(note._id) })));
  }, [notes, isSuccess, user?.id, setRecentNotes]);

  const updateFocusedNote = useCallback(async (...args: Parameters<typeof updateNote>) => {
    const ownership = captureMutation(args[0].noteId);
    try {
      const canonical = await updateNote(...args); applyCanonical(canonical, ownership); return canonical;
    } catch (cause) {
      if (cause instanceof NoteWriteConflict) applyCanonical(cause.current, ownership);
      throw cause;
    }
  }, [updateNote, captureMutation, applyCanonical]);
  const refreshSourceRecommendCache = useCallback(async (id: string) => {
    if (focusedNote?._id !== id) { await refreshRecommendCache(id); return; }
    const ownership = captureMutation(id);
    if (!ownership) throw new Error('原笔记已不可用');
    const cache = await refreshRecommendCache(id, focusedNote);
    applyRecommendCache(focusedNote.revision, cache, ownership);
  }, [focusedNote, captureMutation, applyRecommendCache, refreshRecommendCache]);
  const create = useCallback(async (command: CreateNoteCommand) => {
    const note = await createNote(command); createdNote.current = note; return note;
  }, [createNote]);

  useEffect(() => {
    if (!pendingDelete) return;
    const previous = deleteReturnFocus.current ?? document.activeElement as HTMLElement | null;
    deleteRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      deleteReturnFocus.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [pendingDelete]);

  const groups: { label: string; notes: Note[] }[] = [];
  notes.forEach((note) => {
    const label = creationGroup(note.createdAt);
    if (groups[groups.length - 1]?.label === label) groups[groups.length - 1].notes.push(note);
    else groups.push({ label, notes: [note] });
  });
  return (
    <main className={styles.workspace + (relatedId ? ' ' + styles.withRelated : '')}>
      <div ref={listRef} data-testid="notes-list-scroll" className={styles.scroll} hidden={detail}
        onScroll={(event) => { listScroll.current = event.currentTarget.scrollTop; }}>
        <div className={styles.page}>
          <header className={styles.pageHeader}>
            <p className={styles.date}>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</p>
            <h1>笔记</h1><p>写下此刻。之后可以把它交给 AI，继续想下去。</p>
          </header>
          <button type="button" className={styles.quickCapture} onClick={() => go('/notes?compose=1')} aria-label="打开快速记录">
            <span className={styles.captureIcon}><PencilLine size={16} /></span><span>记下一个想法…</span><Plus size={17} />
          </button>
          <div className={styles.listBar}><h2>最近记录 <span>已加载 {notes.length} 条</span></h2><span>按创建时间</span></div>
          {error && <div className={styles.error} role="alert">{error} <button type="button" className={styles.button} onClick={() => { setError(''); void refetchNotes(); }}>重试</button></div>}
          {isLoading && !notes.length ? <p className={styles.empty} role="status">正在加载笔记…</p> : !notes.length && !error ? <div className={styles.empty}><h3>从一个想法开始</h3><p>写下此刻的思考，让它们慢慢产生联系。</p></div> : groups.map((group, index) => (
            <section className={styles.group} key={group.label + ':' + index} aria-label={group.label}>
              <h3>{group.label}</h3>
              {group.notes.map((note) => {
                const display = noteReferenceDisplay(note);
                return <button type="button" key={note._id} className={styles.noteRow} onClick={() => openNote(note._id)} aria-label={'阅读笔记：' + display.label}>
                  {note.title?.trim() && <span className={styles.rowHeading}>{display.label}</span>}
                  <span className={styles.excerpt}>{note.excerpt || note.contentText || note.content || (!note.title?.trim() ? display.label : '')}</span>
                  {display.dateLabel && <span className={styles.noteMeta}>{display.dateLabel}</span>}
                </button>;
              })}
            </section>
          ))}
          {!!notes.length && <footer className={styles.listFooter}>
            {loadMoreError && <p role="alert" className={styles.error}>{loadMoreError}</p>}
            {(hasMoreNotes || loadMoreError) && <button type="button" className={styles.button} disabled={isLoadingMore} onClick={() => void loadMoreNotes()}>{isLoadingMore ? '正在加载…' : loadMoreError ? '重试加载更早的笔记' : '加载更早的笔记'}</button>}
            {!hasMoreNotes && !loadMoreError && <span>已经看到最早的记录</span>}
          </footer>}
        </div>
      </div>
      {detail && <div className={styles.scroll} ref={detailRef}>
        <div className={styles.page}>
          <button type="button" className={styles.backButton} onClick={() => go('/notes')}><ArrowLeft size={15} />返回笔记列表</button>
          {compose ? <NoteWorkspaceEditor key={'compose:' + (user?.id ?? '')} mode="compose" userId={user?.id ?? null} createNote={create}
            onCancel={() => router.push('/notes', { scroll: false })}
            onSaved={() => { const id = createdNote.current?._id; router.push(id ? '/notes?highlight=' + encodeURIComponent(id) : '/notes', { scroll: false }); }} />
            : currentNote ? editing === user?.id + ':' + currentNote._id ?
              <NoteWorkspaceEditor key={'edit:' + user?.id + ':' + currentNote._id} mode="edit" note={currentNote} userId={user?.id ?? null} updateNote={updateFocusedNote}
                onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setError(''); }} />
              : <NoteWorkspaceReader key={currentNote._id} note={currentNote} relatedOpen={relatedId === currentNote._id}
                onDiscuss={() => actSafely(() => { void discuss(currentNote); })} discussing={discussing}
                onEdit={() => actSafely(() => setEditing(user?.id + ':' + currentNote._id))}
                onRelated={() => setRelatedId((id) => id === currentNote._id ? null : currentNote._id)}
                onDelete={(trigger) => actSafely(() => {
                  deleteReturnFocus.current = trigger ?? document.activeElement as HTMLElement | null;
                  setDeleteError(''); setPendingDelete(currentNote._id);
                })} />
            : focused.state?.status === 'missing' ? <p role="status" className={styles.empty}>原笔记已删除或当前账号无权查看。</p>
              : focused.state?.status === 'error' ? <div className={styles.error} role="alert">原笔记读取失败。<button type="button" className={styles.button} onClick={focused.retry}>重试</button></div>
                : <p role="status" className={styles.empty}>正在读取原笔记…</p>}
          {discussionError && <p role="alert" className={styles.error}>{discussionError}</p>}
        </div>
      </div>}
      {relatedId && <RelatedNotesDrawer isOpen selectedNoteId={relatedId} onClose={() => setRelatedId(null)}
        allNotes={focusedNote ? [...notes, focusedNote] : notes} onRefreshRecommendCache={refreshSourceRecommendCache} onOpenNote={openNote} />}
      {pendingDelete && <div className={styles.modalBackdrop} onClick={() => { if (!deleting) setPendingDelete(null); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="note-delete-title" className={styles.modal} ref={deleteRef} onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!deleting) setPendingDelete(null); }
            if (event.key === 'Tab') {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const first = buttons[0], last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}>
          <h2 id="note-delete-title">删除笔记</h2><p>确定要删除这条笔记吗？此操作无法撤销。</p>
          {deleteError && <p className={styles.error} role="alert">{deleteError}</p>}
          <div className={styles.modalActions}>
            <button type="button" className={styles.button} disabled={deleting} onClick={() => setPendingDelete(null)}>取消</button>
            <button type="button" className={styles.dangerButton} disabled={deleting} onClick={async () => {
              if (deleting) return;
              const id = pendingDelete; setDeleting(true); setDeleteError('');
              const owner = discussionOwner.current;
              const isCurrent = () => active.current && discussionOwner.current === owner && owner.noteId === id;
              try {
                await deleteNote(id);
                if (!isCurrent()) return;
                focused.markUnavailable(id); setPendingDelete(null); go('/notes');
              } catch (cause) {
                if (isCurrent()) setDeleteError(cause instanceof Error ? cause.message : '删除失败，请重试。');
              } finally {
                if (active.current) {
                  setDeleting(false);
                  if (discussionOwner.current !== owner) setPendingDelete(null);
                }
              }
            }}>{deleting ? '删除中…' : '删除'}</button>
          </div>
        </div>
      </div>}
    </main>
  );
}

export default function NotesPage() {
  return <Suspense fallback={<p role="status">正在加载笔记…</p>}><NotesContent /></Suspense>;
}

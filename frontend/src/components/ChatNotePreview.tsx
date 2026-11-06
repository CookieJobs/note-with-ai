/*
Input: 当前用户、选中笔记和关闭/完整阅读回调
Output: 只读原文面板；独立加载最新保存内容，不改变聊天绑定或提供编辑工具
Pos: 聊天页旁栏；修改时同步本目录 README
*/
'use client';

import { lazy, Suspense, type RefObject } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { useFocusedSourceNote } from '../app/notes/hooks/useFocusedSourceNote';
import reading from '../app/notes/NotesWorkspace.module.scss';
import styles from './ChatNotePreview.module.scss';

const RichTextViewer = lazy(() => import('../app/notes/components/RichTextViewer'));

type Props = {
  userId: string;
  noteId: string;
  panelRef: RefObject<HTMLDivElement>;
  isModal: boolean;
  onClose: () => void;
  onOpenFull: () => void;
};

export default function ChatNotePreview({ userId, noteId, panelRef, isModal, onClose, onOpenFull }: Props) {
  const { state, retry } = useFocusedSourceNote(userId, noteId, false);
  const note = state?.status === 'ready' ? state.note : undefined;
  return (
    <div className={styles.slot}>
      {isModal && <button className={styles.backdrop} aria-label="关闭笔记预览遮罩" onClick={onClose} tabIndex={-1} />}
      <div ref={panelRef} tabIndex={-1} role={isModal ? 'dialog' : 'complementary'} aria-modal={isModal || undefined} aria-label="笔记阅读" className={styles.panel}>
        <header className={styles.header}>
          <span>最新保存的笔记</span>
          <button onClick={onOpenFull} className={styles.full}>打开完整笔记<ArrowUpRight size={15} aria-hidden="true" /></button>
          <button onClick={onClose} className={styles.close} aria-label="关闭笔记" title="关闭笔记（Esc）"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className={styles.body} key={userId + ':' + noteId}>
          {note ? <article>
            {note.title?.trim() && <h2>{note.title}</h2>}
            <div className={reading.readingBody}>
              <Suspense fallback={<p role="status">正在加载正文…</p>}>
                <RichTextViewer value={note.contentJson || note.content || note.contentText || ''} preserveLineBreaks />
              </Suspense>
            </div>
          </article> : state?.status === 'missing' ? <p role="status">笔记已删除或当前账号无权查看。</p>
            : state?.status === 'error' ? <div role="alert"><p>暂时无法读取笔记。</p><button onClick={retry} className={styles.retry}>重试</button></div>
              : <p role="status">正在读取笔记…</p>}
        </div>
      </div>
    </div>
  );
}

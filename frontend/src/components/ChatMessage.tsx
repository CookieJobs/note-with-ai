/*
Input: 聊天消息、开场笔记上下文、实际来源快照与旧版讨论笔记
Output: 标识 AI 回答与历史开场，展示 Markdown 回答及可展开的真实来源快照
Pos: 前端聊天消息呈现组件
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
import React from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatMessage.module.scss';
import { IRelatedNote, ISourceSnapshot } from '../types';
import { noteReferenceDisplay } from '../utils/noteReference';
import ChatOpeningNote from './ChatOpeningNote';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  sourceSnapshot?: ISourceSnapshot;
  relatedNotes?: IRelatedNote[];
  openingNote?: IRelatedNote;
  searchingNotes?: boolean;
  isLoading?: boolean;
}

const snapshotTimestampFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
});

export default function ChatMessage({ role, content, sourceSnapshot, relatedNotes, openingNote, isLoading }: ChatMessageProps) {
  const isUser = role === 'user';
  const discussionNote = !isUser && !sourceSnapshot
    ? openingNote ?? relatedNotes?.find(note => note.matchType === 'care_source' && (note.noteId || note.id))
    : undefined;
  const sourceDisplay = sourceSnapshot ? noteReferenceDisplay(sourceSnapshot) : null;
  const sourceUpdatedAt = sourceSnapshot ? new Date(sourceSnapshot.updatedAt) : null;
  const updatedAtLabel = sourceUpdatedAt && !Number.isNaN(sourceUpdatedAt.getTime())
    ? `${snapshotTimestampFormat.format(sourceUpdatedAt)}（UTC+08:00）`
    : sourceSnapshot?.updatedAt;

  return (
    <div className={styles.messageWrapper}>
      {discussionNote && <ChatOpeningNote key={discussionNote.noteId || discussionNote.id} note={discussionNote} />}
      {isUser ? (
        // 用户消息：使用卡片包装
        <div className={styles.userMessageCard}>
          <div className={styles.userMessage}>
            {content}
          </div>
        </div>
      ) : (
        // AI消息：直接渲染内容，支持Markdown
        <div className={`${styles.assistantMessage} ${discussionNote ? styles.openingMessage : ''}`} role={discussionNote ? 'region' : undefined} aria-label={discussionNote ? 'AI 开场提问' : undefined}>
          {!discussionNote && <div className={styles.assistantIdentity}><span aria-hidden="true">✦</span>NoteWithAI</div>}
          {discussionNote && <div className={styles.openingIdentity}><span className={styles.aiMark} aria-hidden="true">AI</span><span>AI 开场提问</span></div>}
          {!content && isLoading ? (
            <div className={styles.loadingDots}>
              <span></span><span></span><span></span>
            </div>
          ) : (
            <>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children, node: _node, ...props }) => (
                    <div
                      className={styles.markdownTableWrapper}
                      role="region"
                      aria-label="可横向滚动的表格"
                      tabIndex={0}
                    >
                      <table {...props}>{children}</table>
                    </div>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
              {isLoading && <span className={styles.blinkingCursor}></span>}
            </>
          )}
        </div>
      )}

      {!isUser && sourceSnapshot && (
        <section className={styles.sourceBasis} aria-label="本次回答依据">
          <div className={styles.sourceBasisHeader}>本次回答依据</div>
          <Link
            href={`/notes?highlight=${encodeURIComponent(sourceSnapshot.noteId)}`}
            className={styles.sourceNoteLink}
          >
            {sourceDisplay?.label}
          </Link>
          <div className={styles.sourceMetadata}>
            <span>版本 {sourceSnapshot.revision}</span>
            <span>更新于 <time dateTime={sourceSnapshot.updatedAt}>{updatedAtLabel}</time></span>
          </div>
          {sourceSnapshot.hasImages && <p className={styles.sourceLimitation}>仅使用文字内容，图片尚未识别。</p>}
          <details className={styles.sourceDetails}>
            <summary>查看本次使用的笔记原文</summary>
            <div className={styles.sourceText} role="region" aria-label="本次使用的笔记原文">
              {sourceSnapshot.contentText}
            </div>
          </details>
        </section>
      )}

      {/* 笔记引用卡片：当从随机漫步卡片发起对话时，展示当前讨论的笔记 */}
      {!isUser && !discussionNote && relatedNotes && relatedNotes.length > 0 && (
        <div className={styles.relatedNotesContainer}>
          <div className={styles.relatedNotesHeader}>
            正在讨论的笔记
          </div>
          <div className={styles.relatedNotesList}>
            {relatedNotes.map((note, i) => {
              const noteId = note.noteId || note.id;
              if (!noteId) return null;
              const display = noteReferenceDisplay(note);
              return (
              <Link
                key={noteId || i}
                href={`/notes?highlight=${encodeURIComponent(noteId)}`}
                className={styles.relatedNoteItem}
              >
                <div className={styles.noteHeader}>
                  <span className={styles.noteTitle}>{display.label}</span>
                </div>
                {display.firstImageSrc && <img src={display.firstImageSrc} alt="笔记首图" width={64} height={64} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }} />}
                {(display.dateLabel || display.secondary) && (
                  <div className={styles.noteContent}>
                    {[display.dateLabel, display.secondary].filter(Boolean).join(' · ')}
                  </div>
                )}
              </Link>
            ); })}
          </div>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import styles from './ChatMessage.module.scss';
import { IRelatedNote } from '../types';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  relatedNotes?: IRelatedNote[];
  searchingNotes?: boolean;
  isLoading?: boolean;
}

export default function ChatMessage({ role, content, relatedNotes, isLoading }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={styles.messageWrapper}>
      {isUser ? (
        // 用户消息：使用卡片包装
        <div className={styles.userMessageCard}>
          <div className={styles.userMessage}>
            {content}
          </div>
        </div>
      ) : (
        // AI消息：直接渲染内容，支持Markdown
        <div className={styles.assistantMessage}>
          {!content && isLoading ? (
            <div className={styles.loadingDots}>
              <span></span><span></span><span></span>
            </div>
          ) : (
            <>
              <ReactMarkdown>{content}</ReactMarkdown>
              {isLoading && <span className={styles.blinkingCursor}></span>}
            </>
          )}
        </div>
      )}

      {/* 笔记引用卡片：当从随机漫步卡片发起对话时，展示当前讨论的笔记 */}
      {!isUser && relatedNotes && relatedNotes.length > 0 && (
        <div className={styles.relatedNotesContainer}>
          <div className={styles.relatedNotesHeader}>
            正在讨论的笔记
          </div>
          <div className={styles.relatedNotesList}>
            {relatedNotes.map((note, i) => (
              <Link
                key={note.noteId || i}
                href={`/notes?highlight=${note.noteId}`}
                className={styles.relatedNoteItem}
              >
                <div className={styles.noteHeader}>
                  <span className={styles.noteTitle}>{note.title || '未命名笔记'}</span>
                </div>
                {note.content && (
                  <div className={styles.noteContent}>
                    {note.content.length > 120 ? note.content.slice(0, 120) + '...' : note.content}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

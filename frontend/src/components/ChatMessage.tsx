import React from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './ChatMessage.module.scss';

interface RelatedNote {
  id: string;
  title: string;
  content: string;
  similarity: number;
  matchType: string;
  createdAt: string;
}

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  relatedNotes?: RelatedNote[];
  searchingNotes?: boolean;
}

export default function ChatMessage({ role, content, relatedNotes, searchingNotes }: ChatMessageProps) {
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
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
      
      {/* 显示搜索中的loading提示 - 只在AI回复且正在搜索时显示 */}
      {!isUser && searchingNotes && (
        <div className={styles.searchingNotesContainer}>
          <div className={styles.searchingIndicator}>
            <div className={styles.loadingDots}>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className={styles.searchingText}>正在从笔记中寻找相关内容...</span>
          </div>
        </div>
      )}
      
      {/* 显示相关笔记 - 只在AI回复且有相关笔记时显示 */}
      {!isUser && relatedNotes && relatedNotes.length > 0 && (
        <div className={styles.relatedNotesContainer}>
          <div className={styles.relatedNotesHeader}>
            📝 相关笔记 ({relatedNotes.length})
          </div>
          <div className={styles.relatedNotesList}>
            {relatedNotes.map((note) => (
              <div key={note.id} className={styles.relatedNoteItem}>
                <div className={styles.noteHeader}>
                  <span className={styles.noteTitle}>{note.title}</span>
                  <span className={styles.noteSimilarity}>
                    {Math.round(note.similarity * 100)}% 相关
                  </span>
                </div>
                <div className={styles.noteContent}>
                  {note.content.length > 200 
                    ? note.content.substring(0, 200) + '...' 
                    : note.content
                  }
                </div>
                <div className={styles.noteFooter}>
                  <span className={styles.noteDate}>
                    {new Date(note.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

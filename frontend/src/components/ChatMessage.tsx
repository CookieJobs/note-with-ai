import React from 'react';
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

export default function ChatMessage({ role, content, isLoading }: ChatMessageProps) {
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
    </div>
  );
}

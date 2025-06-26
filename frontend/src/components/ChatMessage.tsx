import React from 'react';
import styles from './ChatMessage.module.scss';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={`${styles.messageWrapper} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.messageBubble}>
        <p>{content}</p>
      </div>
    </div>
  );
}

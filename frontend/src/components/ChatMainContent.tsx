'use client';

import React, { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import styles from '../app/chat/chat.module.scss';

interface RelatedNote {
  id: string;
  title: string;
  content: string;
  similarity: number;
  matchType: string;
  createdAt: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  relatedNotes?: RelatedNote[];
  searchingNotes?: boolean;
}

interface ChatMainContentProps {
  messages: Message[];
}

const ChatMainContent: React.FC<ChatMainContentProps> = ({ messages }) => {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'smooth',
        block: 'end'
      });
    }
  };

  // 当消息更新时自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      // 延迟滚动，确保DOM已更新
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [messages]);

  return (
    <main className={styles.mainContent}>
      <div className={styles.messagesContainer} ref={messagesContainerRef}>
        <div className={styles.contentWrapper}>
          <div className={`${styles.cardList} ${messages.length === 0 ? styles.emptyCardList : ''}`}>
            {messages.length === 0 ? (
              // 隐藏空状态的视觉元素，仅保留一个占位容器以维持结构
              <div className={styles.emptyStatePlaceholder} aria-hidden="true" />
            ) : (
              <>
                {messages.map((msg, index) => (
                  <ChatMessage 
                    key={index} 
                    role={msg.role} 
                    content={msg.content} 
                    relatedNotes={msg.relatedNotes}
                    searchingNotes={msg.searchingNotes}
                  />
                ))}
                {/* 滚动锚点 */}
                <div ref={messagesEndRef} style={{ height: '1px' }} />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

export default ChatMainContent;
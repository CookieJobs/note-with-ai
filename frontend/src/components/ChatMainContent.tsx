/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
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
  const safeMessages = Array.isArray(messages) ? messages : [];
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
    if (safeMessages.length > 0) {
      // 延迟滚动，确保DOM已更新
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [safeMessages]);

  return (
    <main className={styles.mainContent}>
      <div className={styles.messagesContainer} ref={messagesContainerRef}>
        <div className={styles.contentWrapper}>
          <div className={`${styles.cardList} ${safeMessages.length === 0 ? styles.emptyCardList : ''}`}>
            {safeMessages.length === 0 ? (
              // 隐藏空状态的视觉元素，仅保留一个占位容器以维持结构
              <div className={styles.emptyStatePlaceholder} aria-hidden="true" />
            ) : (
              <>
                {safeMessages.map((msg, index) => {
                  const keyBase = `${msg.role}-${(msg.content || '').slice(0, 20)}`;
                  const itemKey = `${keyBase}-${index}`; // 兜底避免完全相同内容导致key冲突
                  return (
                    <ChatMessage 
                      key={itemKey} 
                      role={msg.role} 
                      content={msg.content} 
                      relatedNotes={msg.relatedNotes}
                      searchingNotes={msg.searchingNotes}
                    />
                  );
                })}
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
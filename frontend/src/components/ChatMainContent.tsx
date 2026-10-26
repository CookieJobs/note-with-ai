/*
Input: 聊天消息、绑定笔记、开场来源、来源快照与滚动恢复位置
Output: 首问后将历史开场收为来源入口，保留真实消息、回答来源和返回位置
Pos: 聊天页主体消息容器
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import ChatMessage from './ChatMessage';
import styles from '../app/chat/chat.module.scss';
import { IMessage, IRelatedNote } from '../types';

interface ChatMainContentProps {
  messages: IMessage[];
  isLoading?: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  restoreScrollTop?: number;
  sourceNoteId?: string;
  openingNote?: IRelatedNote;
}

const ChatMainContent: React.FC<ChatMainContentProps> = ({ messages, isLoading, scrollContainerRef, restoreScrollTop, sourceNoteId, openingNote }) => {
  const safeMessages = useMemo(() => Array.isArray(messages) ? messages : [], [messages]);
  const ownScrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = scrollContainerRef ?? ownScrollContainerRef;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const restoredPositionRef = useRef<number | undefined>(undefined);

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
      if (restoreScrollTop !== undefined) {
        const previous = restoredPositionRef.current;
        if (previous !== restoreScrollTop) {
          if (messagesContainerRef.current) messagesContainerRef.current.scrollTop = restoreScrollTop;
          restoredPositionRef.current = restoreScrollTop;
        }
        // History refreshes may add missing messages. Only an explicit send/selection
        // clears restoration in the page and re-enables automatic scrolling.
        return;
      } else {
        restoredPositionRef.current = undefined;
      }
      // 延迟滚动，确保DOM已更新
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [safeMessages, restoreScrollTop, messagesContainerRef]);

  if (safeMessages.length === 0) {
    return null;
  }

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
                  // Preserve saved history, while the page source link carries the old opening after the first question.
                  if (sourceNoteId && index === 0 && msg.role === 'assistant' && !msg.sourceSnapshot && safeMessages.some(message => message.role === 'user')) return null;
                  const keyBase = `${msg.role}-${(msg.content || '').slice(0, 20)}`;
                  const itemKey = `${keyBase}-${index}`; // 兜底避免完全相同内容导致key冲突
                  return (
                    <ChatMessage 
                      key={itemKey} 
                      role={msg.role} 
                      content={msg.content} 
                      sourceSnapshot={msg.sourceSnapshot}
                      relatedNotes={msg.relatedNotes}
                      openingNote={index === 0 && msg.role === 'assistant' && !msg.sourceSnapshot && sourceNoteId
                        ? openingNote ?? { noteId: sourceNoteId, title: '' }
                        : undefined}
                      searchingNotes={msg.searchingNotes}
                      isLoading={isLoading && index === safeMessages.length - 1}
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

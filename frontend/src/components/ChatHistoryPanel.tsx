'use client';

import React from 'react';
import styles from '../app/chat/chat.module.scss';
import TrashIcon from './icons/TrashIcon';
import PlusIcon from './icons/PlusIcon';

interface ChatSession {
  id: string;
  _id?: string;
  title: string;
  messages: any[];
}

interface ChatHistoryPanelProps {
  sessions: ChatSession[];
  currentSessionId: string;
  isClient: boolean;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
}

const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  sessions,
  currentSessionId,
  isClient,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
}) => {
  return (
    <aside className={styles.historyPanel}>
      <div className={styles.historyHeader}>
        <span>💭 聊天记录</span>
        <button onClick={onNewSession} title="新建对话" aria-label="新建对话">
          <PlusIcon size={16} />
        </button>
      </div>
      <ul className={styles.historyList}>
        {isClient && sessions.length === 0 ? (
          <div className={styles.emptyState} style={{ height: 'auto', padding: '20px 0' }}>
            <div className={styles.emptyText} style={{ fontSize: '14px', marginBottom: '8px' }}>
              暂无聊天记录
            </div>
            <div className={styles.emptySubtext} style={{ fontSize: '12px' }}>
              开始新对话后会显示在这里
            </div>
          </div>
        ) : (
          isClient && sessions.map((session) => {
            return (
              <li
                key={session.id}
                className={session.id === currentSessionId ? styles.activeHistory : ''}
                onClick={() => onSessionSelect(session.id)}
              >
                <span>{session.title}</span>
                <button 
                  className={styles.deleteButton}
                  onClick={(e) => onDeleteSession(e, session.id)}
                  title="删除对话"
                  aria-label="删除对话"
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
};

export default ChatHistoryPanel;
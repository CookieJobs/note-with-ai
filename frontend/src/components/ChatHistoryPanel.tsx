'use client';

import React, { useState } from 'react';
import {
  Search,
  SquarePen,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { IChat } from '../types';
import { usePanelDismiss } from '../hooks/usePanelDismiss';
import {
  getChatHistoryLabel,
  matchesChatHistoryQuery,
} from '../utils/chatHistory';
import styles from './ChatHistoryPanel.module.scss';

interface ChatHistoryPanelProps {
  sessions: IChat[];
  currentSessionId: string;
  isClient: boolean;
  embedded?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
}

export default function ChatHistoryPanel({
  embedded = false,
  sessions,
  currentSessionId,
  isClient,
  isOpen = false,
  onClose = () => {},
  onSessionSelect,
  onNewSession,
  onDeleteSession,
}: ChatHistoryPanelProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const { panelRef, isModal } = usePanelDismiss(!embedded && isOpen, onClose, 767);
  const visibleSessions = sessions.filter((session) =>
    matchesChatHistoryQuery(session, query),
  );
  const newChat = () => {
    onNewSession();
    onClose();
  };

  if (!embedded && collapsed && !isOpen)
    return (
      <aside className={styles.rail} aria-label="聊天历史">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="展开聊天侧栏"
          onClick={() => setCollapsed(false)}
        >
          <PanelLeftOpen size={18} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="开启新对话"
          onClick={newChat}
        >
          <SquarePen size={18} />
        </button>
      </aside>
    );

  return (
    <>
      {!embedded && isOpen && (
        <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      )}
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={`${styles.sidebar} ${embedded ? styles.embedded : ''} ${isOpen ? styles.open : ''}`}
        aria-label="聊天历史"
        role={!embedded && isOpen && isModal ? 'dialog' : undefined}
        aria-modal={!embedded && isOpen && isModal ? true : undefined}
      >
        {!embedded && <div className={styles.toolbar}>
          <button type="button" className={styles.newChat} onClick={newChat}>
            <SquarePen size={18} />
            开启新对话
          </button>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.desktopCollapse}`}
            aria-label="收起聊天侧栏"
            onClick={() => setCollapsed(true)}
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.mobileClose}`}
            aria-label="关闭聊天侧栏"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>}
        <label className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="搜索已加载的对话"
            aria-label="搜索聊天"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={styles.listHeading}>
          <h2>你的聊天</h2>
          <span>{sessions.length}</span>
        </div>
        <nav className={styles.list} aria-label="历史对话">
          {!isClient ? (
            <p className={styles.empty}>正在加载聊天…</p>
          ) : visibleSessions.length === 0 ? (
            <div className={styles.empty}>
              <p>{query.trim() ? '没有找到这个话题' : '还没有聊天记录'}</p>
              <p>
                {query.trim()
                  ? '换个关键词试试。'
                  : '开启新对话，聊聊你的笔记或想法。'}
              </p>
            </div>
          ) : (
            visibleSessions.map((session) => {
              const label = getChatHistoryLabel(session);
              return (
                <div
                  key={session.id}
                  className={`${styles.session} ${session.id === currentSessionId ? styles.selected : ''}`}
                >
                  <button
                    type="button"
                    className={styles.selectSession}
                    aria-current={
                      session.id === currentSessionId ? 'page' : undefined
                    }
                    title={label}
                    onClick={() => {
                      onSessionSelect(session.id);
                      onClose();
                    }}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    aria-label={`删除对话：${label}`}
                    title={`删除对话：${label}`}
                    onClick={(event) => {
                      onClose();
                      onDeleteSession(event, session.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </nav>
      </aside>
    </>
  );
}

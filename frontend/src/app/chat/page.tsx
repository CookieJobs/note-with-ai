'use client';

import { useEffect, useState } from 'react';
import Sidebar from '../../components/Sidebar';
import ChatMessage from '../../components/ChatMessage';
import styles from './chat.module.scss';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const messages = currentSession?.messages || [];

  // 创建新会话
  const startNewSession = () => {
    const newId = Date.now().toString();
    const newSession: ChatSession = {
      id: newId,
      title: '新对话 ' + new Date().toLocaleTimeString(),
      messages: [],
    };
    setSessions([newSession, ...sessions]);
    setCurrentSessionId(newId);
  };

  useEffect(() => {
    if (sessions.length === 0) {
      startNewSession();
    }
  }, []);

  const handleSend = async () => {
    if (!input.trim() || !currentSession) return;
    const userMessage = { role: 'user', content: input };
    const updatedMessages = [...currentSession.messages, userMessage];
    updateSessionMessages(currentSession.id, updatedMessages);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });
      if (!res.ok) throw new Error('请求失败');
      const data = await res.json();
      const assistantMessage = { role: 'assistant', content: data.reply };
      updateSessionMessages(currentSession.id, [...updatedMessages, assistantMessage]);
    } catch (err) {
      console.error(err);
      setError('发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const updateSessionMessages = (sessionId: string, newMessages: Message[]) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, messages: newMessages } : session
      )
    );
  };

  return (
    <div className={styles.container}>
      {/* 左侧侧边栏 */}
      <Sidebar />
      {/* 主聊天区域 */}
      <main className={styles.mainContent}>
        <h1 className={styles.pageTitle}>💬 Chat</h1>

        <div className={styles.cardList}>
          {messages.map((msg, index) => (
            <ChatMessage key={index} role={msg.role} content={msg.content} />
          ))}
        </div>

        <div className={styles.inputWrapper}>
          <textarea
              className={styles.inputField}
              placeholder="说点什么..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto'; // 重置高度
                  target.style.height = `${target.scrollHeight}px`; // 设置为内容高度
              }}
              rows={1}
          />
          <button
            onClick={handleSend}
            disabled={loading}
            className={styles.submitButton}
          >
            send
          </button>
        </div>
        {error && <p className={styles.errorText}>{error}</p>}
      </main>
      {/* 右侧聊天记录列表 */}
      <aside className={styles.historyPanel}>
        <div className={styles.historyHeader}>
          <span>🗂️ 聊天记录</span>
          <button onClick={startNewSession}>➕</button>
        </div>
        <ul className={styles.historyList}>
          {sessions.map((session) => (
            <li
              key={session.id}
              className={session.id === currentSessionId ? styles.activeHistory : ''}
              onClick={() => setCurrentSessionId(session.id)}
            >
              {session.title}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
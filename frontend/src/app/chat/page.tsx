'use client';

import { useEffect, useState } from 'react';
import Sidebar from '../../components/Sidebar';
import ChatMessage from '../../components/ChatMessage';
import styles from './chat.module.scss';
import { getOrCreateUUID } from '../../utils/uuid';

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
  const userId = getOrCreateUUID();
  const storageKey = `chat_sessions_${userId}`;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const messages = currentSession?.messages || [];

  // 保存单个会话到数据库
  const saveSessionToDB = async (session: ChatSession) => {
    try {
      const res = await fetch('/api/chat/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sessionId: session.id.startsWith('local_') ? null : session.id,
          title: session.title,
          messages: session.messages,
        }),
      });
      const data = await res.json();

      if (session.id.startsWith('local_') && data.sessionId) {
        // 替换本地 ID 为数据库 ID
        const updated = sessions.map((s) =>
          s.id === session.id ? { ...s, id: data.sessionId } : s
        );
        setSessions(updated);
        setCurrentSessionId(data.sessionId);
        localStorage.setItem(storageKey, JSON.stringify(updated));
      }
    } catch (err) {
      console.error('❌ 保存聊天记录失败:', err);
    }
  };

  const startNewSession = () => {
    const newId = 'local_' + Date.now();
    const newSession: ChatSession = {
      id: newId,
      title: '新对话 ' + new Date().toLocaleTimeString(),
      messages: [],
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    setCurrentSessionId(newId);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  // 从数据库加载记录（首次加载）
  const loadSessionsFromDB = async () => {
    try {
      const res = await fetch(`/api/chat/list?userId=${userId}`);
      const data = await res.json();
      if (data.sessions) {
        const combined = [...data.sessions, ...sessions];
        setSessions(combined);
        setCurrentSessionId(combined[0]?.id || '');
        localStorage.setItem(storageKey, JSON.stringify(combined));
      }
    } catch (err) {
      console.error('❌ 获取聊天记录失败:', err);
    }
  };

  useEffect(() => {
    const local = localStorage.getItem(storageKey);
    const parsed: ChatSession[] = local ? JSON.parse(local) : [];
    setSessions(parsed);
    setCurrentSessionId(parsed[0]?.id || '');
    loadSessionsFromDB(); // 同步加载远端数据
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
      const finalMessages = [...updatedMessages, assistantMessage];
      updateSessionMessages(currentSession.id, finalMessages);
      // ✅ 存数据库
      const sessionToSave = {
        ...currentSession,
        messages: finalMessages,
      };
      await saveSessionToDB(sessionToSave);
    } catch (err) {
      console.error(err);
      setError('发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const updateSessionMessages = (sessionId: string, newMessages: Message[]) => {
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, messages: newMessages } : s
    );
    setSessions(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
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
          {sessions.map((s) => (
            <li
              key={s.id}
              className={s.id === currentSessionId ? styles.activeHistory : ''}
              onClick={() => setCurrentSessionId(s.id)}
            >
              {s.title}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

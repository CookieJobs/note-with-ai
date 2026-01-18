/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './chat.module.scss';
import { isAuthenticated, getUser, authFetch } from '../../utils/auth';
import TopNavigation from '../../components/TopNavigation';
import ChatHistoryPanel from '../../components/ChatHistoryPanel';
import ChatMainContent from '../../components/ChatMainContent';
import ChatInputArea from '../../components/ChatInputArea';
import DeleteConfirmModal from '../../components/DeleteConfirmModal';
import { useChatSessions } from '../../hooks/useChatSessions';
import { useChatMessages } from '../../hooks/useChatMessages';
import CareAssistantPanel from '../../components/CareAssistantPanel';

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

interface ChatSession {
  id: string;
  _id?: string; // MongoDB 返回的 _id 字段
  title: string;
  messages: Message[];
}

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [input, setInput] = useState('');
  const [isClient, setIsClient] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string>('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showCare, setShowCare] = useState(false);

  // 使用自定义Hooks
  const {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    loadSessionsFromDB,
    startNewSession: startNewSessionHook,
    deleteSession: deleteSessionHook,
    saveSessionToDB: saveSessionToDBHook,
    updateSessionMessages: updateSessionMessagesHook
  } = useChatSessions(user?.id);
  
  const {
    loading,
    error,
    setError,
    sendMessage: sendMessageHook,
    searchRelatedNotesAsync: searchRelatedNotesAsyncHook
  } = useChatMessages();

  // 确保只在客户端渲染
  useEffect(() => {
    setIsClient(true);
  }, []);
// currentSession 已从 useChatSessions Hook 获取
  const messages = currentSession?.messages || [];

  // 检查用户认证状态
  useEffect(() => {
    if (!isClient) return;
    
    if (!isAuthenticated()) {
      router.push('/auth');
      return;
    }
    
    const userData = getUser();
    if (userData) {
      setUser(userData);
    } else {
      router.push('/auth');
    }
  }, [isClient, router]);

  // 获取本地存储 & 请求服务器记录
  useEffect(() => {
    if (!user?.id || !isClient) return;
    console.log('🟠 useEffect[user] 触发, userId:', user.id);
    const storageKey = `chat_sessions_${user.id}`;
    const local = localStorage.getItem(storageKey);
    const parsed: ChatSession[] = local ? JSON.parse(local) : [];
    console.log('🟠 useEffect[user] 本地 parsed:', parsed);
    
    // 只有在没有会话或当前没有选中会话时，才设置默认选中的会话
    if (sessions.length === 0) {
      setSessions(parsed);
      if (!currentSessionId && parsed.length > 0) {
        console.log('🟠 设置默认选中的会话:', parsed[0]?.id);
        setCurrentSessionId(parsed[0]?.id || '');
      }
    }

    // 如果当前正在创建新会话，则不加载服务器会话
    if (currentSessionId && currentSessionId.startsWith('local_')) {
      console.log('🟠 检测到正在创建新会话，跳过加载服务器会话');
      return;
    }
    
    // 添加防抖，避免频繁加载服务器会话
    const timer = setTimeout(() => {
      console.log('🟠 延迟加载服务器会话');
      loadSessionsFromDB(user.id, parsed);
    }, 1000); // 延迟1秒加载
    
    return () => clearTimeout(timer); // 清除定时器
  }, [user?.id, isClient]); // 移除currentSessionId依赖，避免频繁触发

  // 添加调试日志，帮助排查问题
  useEffect(() => {
    if (!isClient) return;
    console.log('🔍 当前sessions:', sessions);
    console.log('🔍 当前currentSessionId:', currentSessionId);
  }, [sessions, currentSessionId, isClient]);
// 使用 Hook 中的 loadSessionsFromDB 函数

  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const startNewSession = async () => {
    if (user?.id) {
      await startNewSessionHook(user.id);
    }
  };

// 使用 Hook 中的 saveSessionToDB 函数

// 使用 Hook 中的 deleteSession 函数

  // 从本地移除会话
  const removeSessionLocally = (sessionId: string) => {
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    if (user?.id) {
      localStorage.setItem(`chat_sessions_${user.id}`, JSON.stringify(updated));
    }

    // 如果删除的是当前会话，切换到第一个会话
    if (sessionId === currentSessionId) {
      setCurrentSessionId(updated[0]?.id || '');
    }
  };

  // 处理删除按钮点击
  const handleDeleteClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发会话选择
    setSessionToDelete(sessionId);
    setShowDeleteConfirm(true);
  };

  // 确认删除
  const confirmDelete = () => {
    if (sessionToDelete) {
      deleteSessionHook(sessionToDelete);
      setShowDeleteConfirm(false);
      setSessionToDelete('');
    }
  };

  // 取消删除
  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setSessionToDelete('');
  };

// 使用 Hook 中的 searchRelatedNotesAsync 函数

  const handleSend = async () => {
    if (!user?.id) return;
    
    let session = currentSession;
    if (!session) {
      console.log('⚠️ 当前无会话，自动创建新会话...');
      session = await startNewSessionHook(user.id);
    }

    if (session) {
      await sendMessageHook(
        input,
        session,
        user.id,
        updateSessionMessages,
        saveSessionToDBHook,
        setSessions
      );
      setInput('');
    }
  };
  
// 使用 Hook 中的 updateSessionMessages 函数
  const updateSessionMessages = updateSessionMessagesHook;

  // 仅在新会话且消息为空时显示“随机漫步”，并对每个会话只激活一次
  useEffect(() => {
    const sid = currentSession?.id || '';
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (!sid) { setShowCare(false); return; }
    if (hasMessages) { setShowCare(false); return; }
    // 会话存在且消息为空：显示随机漫步
    setShowCare(true);
  }, [currentSession?.id, messages.length]);

  // 如果是服务端渲染，返回加载占位符
  if (!isClient) {
    return <div>Loading...</div>;
  }

  if (!user) return <div>🚀 正在验证用户身份...</div>;

  const handleInputChange = (value: string) => {
    setInput(value);
    console.log('📝 输入框内容变化:', value);
  };

  const handleSendClick = () => {
    console.log('📨 点击了 Send 按钮, 当前input:', input, 'loading:', loading, 'currentSession:', currentSession);
    handleSend();
  };

  const handleCareInsert = (text: string) => {
    setInput(text);
  };

  const handleCareSend = async (text: string) => {
    if (!currentSession || !user?.id) return;
    const prev = input;
    setInput(text);
    await sendMessageHook(
      text,
      currentSession,
      user.id,
      updateSessionMessages,
      saveSessionToDBHook,
      setSessions
    );
    setInput(prev);
  };

  return (
    <div className={`${styles.container} ${messages.length === 0 ? styles.emptyContainer : ''}`}>
      <TopNavigation />
      
      <ChatHistoryPanel
        sessions={sessions}
        currentSessionId={currentSessionId}
        isClient={isClient}
        onSessionSelect={setCurrentSessionId}
        onNewSession={startNewSession}
        onDeleteSession={handleDeleteClick}
      />

      <ChatMainContent messages={messages} />

      {/* 提示文案已移动到 ChatInputArea 内部，使其与输入框位置和宽度一致 */}

      <ChatInputArea
        input={input}
        loading={loading}
        error={error}
        onInputChange={handleInputChange}
        onSend={handleSendClick}
        centered={messages.length === 0}
        suggestionComponent={
          currentSession && showCare ? (
            <CareAssistantPanel 
              auto={true} 
              onInsert={handleCareInsert} 
              onSend={handleCareSend} 
            />
          ) : null
        }
      />

      <DeleteConfirmModal
        show={showDeleteConfirm}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

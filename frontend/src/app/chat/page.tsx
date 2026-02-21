/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import styles from './chat.module.scss';
import TopNavigation from '../../components/TopNavigation';
import ChatHistoryPanel from '../../components/ChatHistoryPanel';
import ChatMainContent from '../../components/ChatMainContent';
import ChatInputArea from '../../components/ChatInputArea';
import DeleteConfirmModal from '../../components/DeleteConfirmModal';
import { useChatSession } from '../../hooks/useChatSession';
import { useChatStream } from '../../hooks/useChatStream';
import CareAssistantPanel from '../../components/CareAssistantPanel';
import ChatRelatedNotesPanel from '../../components/ChatRelatedNotesPanel';
import { useAuthGuard } from '../../hooks/useAuthGuard';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string>('');
  const [showCare, setShowCare] = useState(false);

  const { user, isClient } = useAuthGuard();

  // 使用自定义Hooks
  const {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    startNewSession: startNewSessionHook,
    deleteSession: deleteSessionHook,
    saveSessionToDB: saveSessionToDBHook,
    updateSessionMessages: updateSessionMessagesHook,
    addCareMessage
  } = useChatSession(user?.id);
  
  const {
    loading,
    error,
    sendMessage: sendMessageHook,
  } = useChatStream();

  const messages = currentSession?.messages || [];

  const startNewSession = async () => {
    // 检查当前会话是否已经是新对话（无消息）
    const isCurrentSessionEmpty = currentSession && (!currentSession.messages || currentSession.messages.length === 0);
    
    if (isCurrentSessionEmpty) {
      toast('你已经在新对话中了～');
      return;
    }

    if (user?.id) {
      await startNewSessionHook(user.id);
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
        updateSessionMessagesHook,
        saveSessionToDBHook,
        setSessions
      );
      setInput('');
    }
  };
  
  // 仅在新会话且消息为空时显示“随机漫步”，并对每个会话只激活一次
  useEffect(() => {
    // 只要消息为空，就显示（无论是否有 currentSession，没有 session 意味着是新用户或新会话状态）
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (hasMessages) {
      setShowCare(false);
    } else {
      setShowCare(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // 如果是服务端渲染，返回加载占位符
  if (!isClient) {
    return <div>Loading...</div>;
  }

  if (!user) return <div>🚀 正在验证用户身份...</div>;

  const handleInputChange = (value: string) => {
    setInput(value);
  };

  const handleSendClick = () => {
    handleSend();
  };

  const handleCareInsert = (text: string) => {
    setInput(text);
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

      <ChatMainContent messages={messages} isLoading={loading} />

      <ChatInputArea
        input={input}
        loading={loading}
        error={error}
        onInputChange={handleInputChange}
        onSend={handleSendClick}
        centered={messages.length === 0}
        suggestionComponent={
          showCare ? (
            <CareAssistantPanel 
              auto={true} 
              onInsert={handleCareInsert} 
              onSend={addCareMessage} 
            />
          ) : null
        }
      />

      <ChatRelatedNotesPanel 
        relatedNotes={currentSession?.relatedNotes || []} 
        className={styles.rightPanel}
      />

      <DeleteConfirmModal
        show={showDeleteConfirm}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

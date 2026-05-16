/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BookOpen, X } from 'lucide-react';
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
  const router = useRouter();
  const [input, setInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string>('');
  const [showCare, setShowCare] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isRelatedNotesOpen, setIsRelatedNotesOpen] = useState(false);

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
  const relatedNotes = currentSession?.relatedNotes || [];

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
      if (loading && sessionToDelete === currentSessionId) {
        toast('AI 正在回复，完成后再删除当前对话');
        return;
      }
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

  // 如果是服务端渲染，或者正在验证用户身份，返回占位符但保留 TopNavigation 以防闪烁
  if (!isClient || !user) {
    return (
      <div className={`${styles.container} ${styles.emptyContainer}`}>
        <TopNavigation onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flex: 1, color: '#888' }}>
          <div className="flex flex-col items-center gap-3">
            <div className="loading-spinner" style={{
              width: '24px',
              height: '24px',
              border: '3px solid rgba(0,0,0,0.1)',
              borderTopColor: '#333',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span>{!isClient ? 'Loading...' : '🚀 正在验证用户身份...'}</span>
          </div>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

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
      <TopNavigation onMenuClick={() => setIsMobileSidebarOpen(true)} />
      
      <div className={styles.bodyWrapper}>
        <ChatHistoryPanel
          sessions={sessions}
          currentSessionId={currentSessionId}
          isClient={isClient}
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onSessionSelect={setCurrentSessionId}
          onNewSession={startNewSession}
          onDeleteSession={handleDeleteClick}
        />

        <div className={styles.mainCenter}>
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
                  cacheKey={`care_intro_cache_${user.id}`}
                />
              ) : null
            }
          />
        </div>

        <ChatRelatedNotesPanel 
          relatedNotes={relatedNotes} 
          className={styles.rightPanel}
          onNoteClick={(noteId) => router.push(`/notes?highlight=${noteId}`)}
        />
      </div>

      {relatedNotes.length > 0 && (
        <button
          type="button"
          className={styles.relatedNotesFab}
          onClick={() => setIsRelatedNotesOpen(true)}
        >
          <BookOpen size={16} />
          <span>相关笔记</span>
          <strong>{relatedNotes.length}</strong>
        </button>
      )}

      {isRelatedNotesOpen && (
        <div className={styles.relatedNotesOverlay} onClick={() => setIsRelatedNotesOpen(false)}>
          <div className={styles.relatedNotesDrawer} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.relatedNotesClose}
              onClick={() => setIsRelatedNotesOpen(false)}
              aria-label="关闭相关笔记"
            >
              <X size={18} />
            </button>
            <ChatRelatedNotesPanel
              relatedNotes={relatedNotes}
              className={styles.relatedNotesDrawerPanel}
              onNoteClick={(noteId) => {
                setIsRelatedNotesOpen(false);
                router.push(`/notes?highlight=${noteId}`);
              }}
            />
          </div>
        </div>
      )}

      <DeleteConfirmModal
        show={showDeleteConfirm}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

/*
Input: 用户身份、聊天历史、单篇笔记绑定、来源往返上下文及流式回复
Output: 登记真实历史，服务端校验显式会话并隔离失效发送，普通入口清理失效状态；主动选择和成功删除显式目标对齐URL与来源恢复，流状态按会话投影，异步删除可重试
Pos: frontend/src/app/chat 页面入口
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
import { usePanelDismiss } from '../../hooks/usePanelDismiss';
import { rememberChatSourceReturn, takeChatSourceReturn, type ChatSourceReturn } from '../../utils/chatSourceReturn';
import { useWorkspace } from '../../components/workspace/WorkspaceContext';
import type { CareIntro } from '../../types';

function ChatPageContent() {
  const workspace = useWorkspace();
  const registerChatNavigation = workspace?.registerChatNavigation;
  const searchParams = useSearchParams();
  const explicitSessionId = searchParams.get('session')?.trim() || '';
  const explicitSessionHandled = useRef<string | null>(null);
  const [entryError, setEntryError] = useState('');
  const [careError, setCareError] = useState('');
  const router = useRouter();
  const [input, setInput] = useState('');
  const inputRef = useRef(input);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string>('');
  const [showCare, setShowCare] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isRelatedNotesOpen, setIsRelatedNotesOpen] = useState(false);
  const [startingCare, setStartingCare] = useState(false);
  const { panelRef: relatedPanelRef, isModal: isRelatedNotesModal } = usePanelDismiss<HTMLDivElement>(isRelatedNotesOpen, () => setIsRelatedNotesOpen(false), 1199);

  useEffect(() => {
    if (!isRelatedNotesModal) setIsRelatedNotesOpen(false);
  }, [isRelatedNotesModal]);

  const { user, isClient } = useAuthGuard();
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const sourceReturnLoadedFor = useRef<string | null>(null);
  const sourceReturnApplied = useRef<ChatSourceReturn | null>(null);
  const [sourceReturn, setSourceReturn] = useState<ChatSourceReturn | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);

  // 使用自定义Hooks
  const {
    sessions,
    sessionsLoaded,
    sessionsError,
    sessionsLoading,
    retrySessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    startNewSession: startNewSessionHook,
    deleteSession: deleteSessionHook,
    updateSessionMessages: updateSessionMessagesHook,
    addCareMessage
  } = useChatSession(user?.id);
  
  const {
    loading: streamBusy,
    activeSessionId,
    errorSessionId,
    error: streamError,
    sendMessage: sendMessageHook,
  } = useChatStream((previousId, nextId) => {
    setCurrentSessionId(selectedId => selectedId === previousId ? nextId : selectedId);
  });

  const loading = streamBusy && activeSessionId === currentSessionId;
  const error = entryError || careError || (errorSessionId === currentSessionId ? streamError : '');

  useEffect(() => {
    if (!explicitSessionId) {
      explicitSessionHandled.current = null;
      setEntryError('');
      return;
    }
    if (explicitSessionHandled.current === explicitSessionId) return;
    if (sessions.some(session => session.id === explicitSessionId)) {
      // Cache can render immediately, but only the server history completes
      // validation: a stale cached record may disappear when that arrives.
      if (sessionsLoaded) explicitSessionHandled.current = explicitSessionId;
      setEntryError('');
      setCurrentSessionId(explicitSessionId);
    } else {
      setCurrentSessionId('');
      if (sessionsLoaded) {
        explicitSessionHandled.current = explicitSessionId;
        setEntryError('无法打开这段对话：记录不存在、已删除或暂时无法读取。请重试。');
      }
    }
  }, [explicitSessionId, sessions, sessionsLoaded, setCurrentSessionId]);

  const messages = currentSession?.messages || [];
  const relatedNotes = currentSession?.relatedNotes || [];
  const sourceNoteId = currentSession?.sourceNoteId;
  const isNoteOpening = !!sourceNoteId && messages.length > 0 && !messages.some(message => message.role === 'user');
  const otherRelatedNotes = relatedNotes.filter(note => (note.noteId || note.id) !== sourceNoteId);
  // Historical messages may no longer carry their opening metadata. Only use the
  // saved care excerpt here; a later answer snapshot is not the original excerpt.
  const openingNote = messages[0]?.relatedNotes?.find(note => (note.noteId || note.id) === sourceNoteId)
    ?? relatedNotes.find(note => (note.noteId || note.id) === sourceNoteId && note.matchType === 'care_source');
  const latestSource = messages.slice().reverse().find(message => message.sourceSnapshot?.noteId === sourceNoteId)?.sourceSnapshot;
  const sourceTitle = latestSource?.title?.trim()
    || relatedNotes.find(note => (note.noteId || note.id) === sourceNoteId)?.title?.trim()
    || currentSession?.title?.trim()
    || '查看原笔记';

  useEffect(() => {
    selectedSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const updateInput = (value: string) => {
    inputRef.current = value;
    setInput(value);
  };

  useEffect(() => {
    if (!user?.id || sourceReturnLoadedFor.current === user.id) return;
    sourceReturnLoadedFor.current = user.id;
    setSourceReturn(takeChatSourceReturn(user.id));
  }, [user?.id]);

  useEffect(() => {
    if (!sourceReturn || (explicitSessionId && explicitSessionId !== sourceReturn.sessionId) || sourceReturn.userId !== user?.id || sourceReturnApplied.current === sourceReturn) return;
    // History may arrive asynchronously; never substitute another conversation.
    if (!sessions.some((session) => session.id === sourceReturn.sessionId)) return;
    sourceReturnApplied.current = sourceReturn;
    setCurrentSessionId(sourceReturn.sessionId);
    updateInput(sourceReturn.draft);
  }, [explicitSessionId, sourceReturn, sessions, user?.id, setCurrentSessionId]);

  const rememberSourceReturn = () => {
    if (!user?.id || !currentSessionId) return;
    rememberChatSourceReturn({ userId: user.id, sessionId: currentSessionId, draft: inputRef.current, scrollTop: chatScrollRef.current?.scrollTop ?? 0 });
  };

  const openSourceNote = (noteId: string) => {
    rememberSourceReturn();
    setIsRelatedNotesOpen(false);
    router.push(`/notes?highlight=${encodeURIComponent(noteId)}`);
  };

  const handleSourceLink = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a');
    if (!anchor || anchor.target === '_blank') return;
    const target = new URL(anchor.href, window.location.href);
    if (target.origin === window.location.origin && target.pathname === '/notes' && target.searchParams.has('highlight')) rememberSourceReturn();
  };

  const leaveExplicitSession = () => {
    // A deliberate selection supersedes the entry URL. Source return must reopen
    // the conversation the user actually left, rather than the old URL target.
    explicitSessionHandled.current = explicitSessionId;
    if (explicitSessionId) router.replace('/chat', { scroll: false });
  };

  const selectSession = (sessionId: string) => {
    setEntryError(''); setCareError('');
    leaveExplicitSession();
    setSourceReturn(null);
    selectedSessionIdRef.current = sessionId;
    setCurrentSessionId(sessionId);
  };

  // 已保存的笔记绑定会话即使尚未提问也可从工作区恢复；普通本地空会话不展示。
  const nonEmptySessions = useMemo(() => sessions.filter(s => s.sourceNoteId || (s.messages && s.messages.length > 0)), [sessions]);

  const startNewSession = async () => {
    setEntryError(''); setCareError('');
    leaveExplicitSession();
    setSourceReturn(null);
    // 检查当前会话是否已经是新对话（无消息）
    const isCurrentSessionEmpty = currentSession && !currentSession.sourceNoteId && (!currentSession.messages || currentSession.messages.length === 0);
    
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
  const confirmDelete = async () => {
    if (sessionToDelete) {
      if (streamBusy && sessionToDelete === activeSessionId) {
        toast('AI 正在回复，完成后再删除当前对话');
        throw new Error('AI 正在回复，完成后再删除这段对话');
      }
      await deleteSessionHook(sessionToDelete);
      if (sessionToDelete === explicitSessionId) {
        leaveExplicitSession();
        setSourceReturn(null);
        setEntryError('');
      }
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
    if (!user?.id || startingCare) return;
    if (entryError || (explicitSessionId && explicitSessionHandled.current !== explicitSessionId)) {
      toast('请先选择有效对话或开启新对话；你的草稿已保留。');
      return;
    }
    if (streamBusy) { toast('另一段对话正在回复，请等待完成后再发送；你的草稿已保留。'); return; }
    setCareError('');
    setSourceReturn(null);
    
    let session = currentSession;
    if (!session) {
      session = await startNewSessionHook(user.id);
    }

    if (session) {
      selectedSessionIdRef.current = session.id;
      const submittedInput = inputRef.current;
      const sent = await sendMessageHook(
        submittedInput,
        session,
        user.id,
        updateSessionMessagesHook,
        setSessions,
        () => {
          if (inputRef.current === submittedInput) updateInput('');
        },
      );
      if (!sent && inputRef.current === '' && selectedSessionIdRef.current === session.id) {
        updateInput(submittedInput);
      }
    }
  };

  const handleCareSend = async (text: string, intro?: CareIntro) => {
    if (startingCare) return;
    if (streamBusy) { toast('另一段对话正在回复，请等待完成后再开始笔记对话。'); return; }
    setStartingCare(true);
    setEntryError(''); setCareError('');
    leaveExplicitSession();
    setSourceReturn(null);
    try {
      await addCareMessage(text, intro);
    } catch (failure) {
      setCareError(`未能开始笔记对话：${failure instanceof Error ? failure.message : '保存失败'}。请重试或换一条笔记。`);
    } finally {
      setStartingCare(false);
    }
  };
  
  const navigationHandlers = useRef({ selectSession, startNewSession, handleDeleteClick });
  navigationHandlers.current = { selectSession, startNewSession, handleDeleteClick };
  const stableNavigation = useMemo(() => ({
    onSessionSelect: (id: string) => navigationHandlers.current.selectSession(id),
    onNewSession: () => navigationHandlers.current.startNewSession(),
    onDeleteSession: (event: React.MouseEvent, id: string) => navigationHandlers.current.handleDeleteClick(event, id),
  }), []);
  const chatNavigation = useMemo(() => ({
    sessions: nonEmptySessions, currentSessionId, isClient, ...stableNavigation,
  }), [nonEmptySessions, currentSessionId, isClient, stableNavigation]);
  useEffect(() => registerChatNavigation?.(chatNavigation), [registerChatNavigation, chatNavigation]);

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
        {!workspace && <TopNavigation onMenuClick={() => setIsMobileSidebarOpen(true)} />}
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
            <span>{!isClient ? '正在加载…' : '正在验证用户身份…'}</span>
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
    updateInput(value);
  };

  const handleSendClick = () => {
    handleSend();
  };

  const handleCareInsert = (text: string) => {
    updateInput(text);
  };

  return (
    <div className={`${styles.container} ${messages.length === 0 ? styles.emptyContainer : ''}`} onClickCapture={handleSourceLink}>
      {!workspace && <TopNavigation onMenuClick={() => setIsMobileSidebarOpen(true)} />}
      
      <div className={styles.bodyWrapper}>
        {!workspace && <ChatHistoryPanel
          sessions={nonEmptySessions}
          currentSessionId={currentSessionId}
          isClient={isClient}
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onSessionSelect={selectSession}
          onNewSession={startNewSession}
          onDeleteSession={handleDeleteClick}
        />}

        <div className={styles.mainCenter}>
          {sourceNoteId ? (
            <section aria-label="正在讨论" className={isNoteOpening ? styles.openingContext : styles.sourceContext}>
              {isNoteOpening ? <h1>从一条笔记聊起</h1> : <>
                <span>正在讨论</span>
                <Link href={`/notes?highlight=${encodeURIComponent(sourceNoteId)}`}>{sourceTitle}</Link>
                <span className={styles.sourceContextHint}>每次提问读取最新保存的文字</span>
              </>}
            </section>
          ) : messages.length > 0 ? (
            <p className={styles.scopeHint}>如需围绕笔记提问，请开启新对话，选择“从这条笔记聊起”。</p>
          ) : null}
          <ChatMainContent
            messages={messages}
            sourceNoteId={sourceNoteId}
            openingNote={openingNote}
            isLoading={loading}
            scrollContainerRef={chatScrollRef}
            restoreScrollTop={sourceReturn?.userId === user.id && sourceReturn.sessionId === currentSessionId ? sourceReturn.scrollTop : undefined}
          />

          {sessionsError && <div role="alert" className={styles.chatError}>{sessionsError} <button type="button" disabled={sessionsLoading} onClick={() => { void retrySessions(); }}>{sessionsLoading ? '正在重试…' : '重试加载对话'}</button></div>}
          {streamBusy && !loading && <p role="status" className={styles.streamNotice}>另一段对话正在回复，完成后可继续发送。你的草稿会保留。</p>}
          <ChatInputArea
            input={input}
            loading={loading || startingCare}
            error={error}
            onInputChange={handleInputChange}
            onSend={handleSendClick}
            centered={messages.length === 0}
            title={sourceNoteId && messages.length === 0 ? '围绕这篇笔记提问' : undefined}
            placeholder={isNoteOpening ? '接着聊聊你的想法，也可以问点别的…' : undefined}
            suggestionComponent={
              showCare && !sourceNoteId && !explicitSessionId ? (
                <CareAssistantPanel 
                  auto={true} 
                  onInsert={handleCareInsert} 
                  onSend={handleCareSend}
                  cacheKey={`care_intro_cache_${user.id}`}
                />
              ) : null
            }
          />
        </div>

        {otherRelatedNotes.length > 0 && (
          <ChatRelatedNotesPanel
            relatedNotes={otherRelatedNotes}
            className={styles.rightPanel}
            onNoteClick={openSourceNote}
          />
        )}
      </div>

      {otherRelatedNotes.length > 0 && (
        <button
          type="button"
          className={styles.relatedNotesFab}
          onClick={() => setIsRelatedNotesOpen(true)}
        >
          <BookOpen size={16} />
          <span>相关笔记</span>
          <strong>{otherRelatedNotes.length}</strong>
        </button>
      )}

      {isRelatedNotesOpen && otherRelatedNotes.length > 0 && (
        <div className={styles.relatedNotesOverlay} onClick={() => setIsRelatedNotesOpen(false)}>
          <div ref={relatedPanelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="相关笔记" className={styles.relatedNotesDrawer} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.relatedNotesClose}
              onClick={() => setIsRelatedNotesOpen(false)}
              aria-label="关闭相关笔记"
            >
              <X size={18} />
            </button>
            <ChatRelatedNotesPanel
              relatedNotes={otherRelatedNotes}
              className={styles.relatedNotesDrawerPanel}
              onNoteClick={openSourceNote}
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

export default function ChatPage() {
  return <Suspense fallback={<div aria-label="正在加载对话" />}><ChatPageContent /></Suspense>;
}

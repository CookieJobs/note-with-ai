'use client';

import { useState, useEffect, useRef } from 'react';
import { IChat, IMessage, IRelatedNote, CareIntro } from '../types';
import {
  createLocalSessionId,
  deleteChatSessionRemote,
  fetchChatSessionsRemote,
  mergeChatSessions,
  persistChatSessions,
  readChatSessionsFromStorage,
  replaceSessionId,
  saveChatSessionRemote,
} from './chatSessionStore';

interface UseChatSessionReturn {
  sessions: IChat[];
  sessionsLoaded: boolean;
  sessionsError: string;
  sessionsLoading: boolean;
  retrySessions: () => Promise<void>;
  currentSessionId: string;
  currentSession: IChat | undefined;
  setSessions: React.Dispatch<React.SetStateAction<IChat[]>>;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string>>;
  loadSessionsFromDB: (userId: string, localSessions: IChat[]) => Promise<IChat[] | undefined>;
  startNewSession: (userId: string) => Promise<IChat>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionMessages: (sessionId: string, newMessages: IMessage[], userId?: string) => void;
  saveSessionToDB: (userId: string, session: IChat) => Promise<string>;
  addCareMessage: (text: string, introData?: CareIntro) => Promise<void>;
}

export const useChatSession = (userId?: string): UseChatSessionReturn => {
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessions, setSessions] = useState<IChat[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const currentSessionIdRef = useRef(currentSessionId);
  const sessionsRef = useRef<IChat[]>([]);
  const historyOwner = useRef({ userId });
  const historyRequest = useRef<object | null>(null);
  const historyBusy = useRef(false);
  const active = useRef(true);
  if (historyOwner.current.userId !== userId) {
    historyOwner.current = { userId };
    historyRequest.current = null;
    historyBusy.current = false;
  }

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const saveSessionToDB = async (userId: string, session: IChat): Promise<string> => {
    try {
      const isLocalId = session.id.startsWith('local_');
      console.log('🟢 saveSessionToDB 开始保存会话:', session.id, '是本地ID:', isLocalId);

      const serverSessionId = await saveChatSessionRemote(session);

      if (serverSessionId) {
        if (isLocalId && serverSessionId !== session.id) {
          console.log('🟢 saveSessionToDB 本地ID需要更新为服务器ID:', serverSessionId);

          setSessions(prevSessions => {
            const updated = replaceSessionId(prevSessions, session.id, serverSessionId);
            persistChatSessions(userId, updated);
            return updated;
          });

          if (currentSessionIdRef.current === session.id) {
            console.log('🟢 saveSessionToDB 更新当前会话ID:', serverSessionId);
            setCurrentSessionId(serverSessionId);
          }

          return serverSessionId;
        }
      }

      return session.id;
    } catch (error) {
      console.error('❌ 保存会话失败:', error);
      throw error instanceof Error ? error : new Error('保存会话失败');
    }
  };

  const removeSessionLocally = (sessionId: string) => {
    const updated = sessionsRef.current.filter((s) => s.id !== sessionId);

    setSessions(updated);

    if (userId) {
      persistChatSessions(userId, updated);
    }

    if (sessionId === currentSessionIdRef.current) {
      if (updated.length > 0) {
        setCurrentSessionId(updated[0].id || updated[0]._id || '');
      } else {
        setCurrentSessionId('');
      }
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      if (sessionId.startsWith('local_')) {
        removeSessionLocally(sessionId);
        return;
      }

      await deleteChatSessionRemote(sessionId);
      console.log('✅ 聊天记录已从服务器删除');
      removeSessionLocally(sessionId);
    } catch (err) {
      console.error('❌ 删除聊天记录失败:', err);
      throw new Error('删除失败，请稍后重试');
    }
  };

  const startNewSession = async (userId: string): Promise<IChat> => {
    const localId = createLocalSessionId();
    console.log('🔵 startNewSession 生成本地ID:', localId);

    const newSession: IChat = {
      id: localId,
      title: '新对话',
      messages: [],
    };

    setSessions(prev => {
      const updated = [newSession, ...prev];
      persistChatSessions(userId, updated);
      return updated;
    });
    currentSessionIdRef.current = localId;
    setCurrentSessionId(localId);
    console.log('🔵 startNewSession 设置 currentSessionId:', localId);

    return newSession;
  };

  const loadSessionsFromDB = async (requestUserId: string, localSessions: IChat[]) => {
    if (!active.current || historyOwner.current.userId !== requestUserId || historyBusy.current) return undefined;
    const owner = historyOwner.current;
    const request = {};
    historyRequest.current = request;
    historyBusy.current = true;
    const isCurrent = () => active.current && historyOwner.current === owner && historyRequest.current === request;
    setSessionsLoading(true);
    setSessionsLoaded(false);
    try {
      const sessionIdsAtLoadStart = new Set(sessionsRef.current.map(session => session.id));
      const normalizedServerSessions = await fetchChatSessionsRemote();
      if (!isCurrent()) return undefined;

      setSessions(prevSessions => {
        if (!isCurrent()) return prevSessions;
        const localSource = prevSessions.length > 0 ? prevSessions : localSessions;
        const mergedSessions = mergeChatSessions(normalizedServerSessions, localSource);
        const mergedIds = new Set(mergedSessions.map(session => session.id));
        // 请求期间创建并保存的会话可能不在这次服务端快照中，不能被旧历史覆盖。
        const newlyCreatedSessions = localSource.filter(session =>
          !sessionIdsAtLoadStart.has(session.id) && !mergedIds.has(session.id)
        );
        const finalSessions = [...newlyCreatedSessions, ...mergedSessions];

        persistChatSessions(requestUserId, finalSessions);
        return finalSessions;
      });
      setSessionsError('');
      setSessionsLoaded(true);
      return normalizedServerSessions;
    } catch (err) {
      console.error('❌ 获取聊天记录失败:', err);
      if (isCurrent()) setSessionsError('对话历史加载失败，请重试。你的草稿会保留。');
      return undefined;
    } finally {
      if (isCurrent()) { historyBusy.current = false; setSessionsLoading(false); }
    }
  };

  const retrySessions = async () => {
    if (userId) await loadSessionsFromDB(userId, readChatSessionsFromStorage(userId));
  };

  const updateSessionMessages = (sessionId: string, newMessages: IMessage[], userId?: string) => {
    console.log('📝 updateSessionMessages 更新会话消息, sessionId:', sessionId, '新消息数量:', newMessages.length);
    
    setSessions(prevSessions => {
      const sessionToUpdate = prevSessions.find(s => s.id === sessionId);
      if (!sessionToUpdate) {
        console.log('📝 updateSessionMessages 未找到会话:', sessionId);
        return prevSessions;
      }
      
      const updated = prevSessions.map((s) =>
        s.id === sessionId ? { ...s, messages: newMessages } : s
      );

      if (userId) {
        persistChatSessions(userId, updated);
      }

      return updated;
    });
  };

  const addCareMessage = async (text: string, introData?: CareIntro) => {
    if (!userId) return;
    
    // 如果没有会话，先创建会话
    let session = currentSession;
    if (session?.messages.length && introData?.noteId) session = undefined;
    const previousSession = session;
    if (!session) {
       console.log('⚠️ [CareSend] 当前无会话，自动创建新会话...');
       session = await startNewSession(userId);
    }
    
    if (session) {
      // 构造 AI 消息
      const newMessage: IMessage = {
        role: 'assistant',
        content: text,
        relatedNotes: introData?.noteId ? [{
          noteId: introData.noteId,
          title: introData.noteTitle,
          content: introData.snippet,
          excerpt: introData.excerpt,
          sourceType: introData.sourceType,
          imageCount: introData.imageCount,
          firstImageSrc: introData.firstImageSrc,
          createdAtSource: introData.createdAtSource,
          score: 1.0,
          matchType: 'care_source',
          createdAt: introData.createdAtSource === 'note' ? introData.createdAt : undefined
        }] : undefined
      };

      const newMessages = [...session.messages, newMessage];
      
      // 构造会话级相关笔记 (如果 introData 包含笔记)
      const newRelatedNotes: IRelatedNote[] = introData?.noteId ? [{
        noteId: introData.noteId,
        title: introData.noteTitle,
        content: introData.snippet,
        excerpt: introData.excerpt,
        sourceType: introData.sourceType,
        imageCount: introData.imageCount,
        firstImageSrc: introData.firstImageSrc,
        createdAtSource: introData.createdAtSource,
        score: 1.0,
        matchType: 'care_source',
        createdAt: introData.createdAtSource === 'note' ? introData.createdAt : undefined
      }] : [];

      const candidate: IChat = {
        ...session,
        title: introData?.noteTitle || session.title,
        sourceNoteId: introData?.noteId?.trim() || session.sourceNoteId,
        messages: newMessages,
        relatedNotes: [...(session.relatedNotes || []), ...newRelatedNotes],
      };

      // Show a bound opening only after the server accepts the selected source.
      try {
        const savedId = await saveChatSessionRemote(candidate);
        if (!savedId) throw new Error('保存会话未返回有效记录，请重试');
        setSessions(prev => {
          const updated = prev.map(s => s.id === session!.id ? { ...candidate, id: savedId } : s);
          persistChatSessions(userId, updated);
          return updated;
        });
        if (currentSessionIdRef.current === session.id) {
          currentSessionIdRef.current = savedId;
          setCurrentSessionId(savedId);
        }
      } catch (error) {
        console.error('❌ 保存关怀消息失败:', error);
        if (!previousSession) {
          setSessions(prev => {
            const updated = prev.filter(s => s.id !== session!.id);
            persistChatSessions(userId, updated);
            return updated;
          });
          if (currentSessionIdRef.current === session.id) {
            currentSessionIdRef.current = '';
            setCurrentSessionId('');
          }
        }
        throw error instanceof Error ? error : new Error('保存笔记对话失败，请重试');
      }
    }
  };

  // 获取本地存储 & 请求服务器记录
  useEffect(() => {
    active.current = true;
    historyRequest.current = null;
    historyBusy.current = false;
    setSessionsLoaded(false); setSessionsError(''); setSessionsLoading(false);
    sessionsRef.current = [];
    currentSessionIdRef.current = '';
    setCurrentSessionId('');
    if (!userId) {
      setSessions([]);
      return () => { active.current = false; historyRequest.current = null; };
    }
    console.log('🟠 useEffect[userId] 触发, userId:', userId);
    const parsed = readChatSessionsFromStorage(userId);
    console.log('🟠 useEffect[userId] 本地 parsed:', parsed);

    // A new identity owns a separate cache and history request lifecycle.
    setSessions(parsed);
    
    // 添加防抖，避免频繁加载服务器会话
    const timer = setTimeout(() => {
      console.log('🟠 延迟加载服务器会话');
      loadSessionsFromDB(userId, parsed);
    }, 1000); // 延迟1秒加载
    
    return () => { clearTimeout(timer); active.current = false; historyRequest.current = null; };
  }, [userId]);

  return {
    sessions,
    sessionsLoaded,
    sessionsError,
    sessionsLoading,
    retrySessions,
    currentSessionId,
    currentSession,
    setSessions,
    setCurrentSessionId,
    loadSessionsFromDB,
    startNewSession,
    deleteSession,
    updateSessionMessages,
    saveSessionToDB,
    addCareMessage,
  };
};

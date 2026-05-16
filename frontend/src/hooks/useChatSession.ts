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
  const [sessions, setSessions] = useState<IChat[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const currentSessionIdRef = useRef(currentSessionId);
  const sessionsRef = useRef<IChat[]>([]);

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 仅当已选中的会话被删除时才自动切换到其他会话，不在页面加载时自动选中
  useEffect(() => {
    if (sessions.length > 0) {
      const exists = sessions.some(s => s.id === currentSessionId);
      if (currentSessionId && !exists) {
        const firstSession = sessions[0];
        // Prefer 'id', fallback to '_id'
        const firstId = firstSession.id || firstSession._id;
        if (firstId) {
          console.log('🔄 [useChatSession] 当前会话已删除，自动切换到:', firstId);
          setCurrentSessionId(firstId);
        }
      }
    }
  }, [sessions, currentSessionId]);

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
    setCurrentSessionId(localId);
    console.log('🔵 startNewSession 设置 currentSessionId:', localId);

    return newSession;
  };

  const loadSessionsFromDB = async (userId: string, localSessions: IChat[]) => {
    try {
      const normalizedServerSessions = await fetchChatSessionsRemote();

      setSessions(prevSessions => {
        const localSource = prevSessions.length > 0 ? prevSessions : localSessions;
        const finalSessions = mergeChatSessions(normalizedServerSessions, localSource);

        persistChatSessions(userId, finalSessions);
        return finalSessions;
      });
      return normalizedServerSessions;
    } catch (err) {
      console.error('❌ 获取聊天记录失败:', err);
      return undefined;
    }
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
          score: 1.0,
          matchType: 'care_source',
          createdAt: new Date().toISOString()
        }] : undefined
      };

      const newMessages = [...session.messages, newMessage];
      
      // 构造会话级相关笔记 (如果 introData 包含笔记)
      const newRelatedNotes: IRelatedNote[] = introData?.noteId ? [{
        noteId: introData.noteId,
        title: introData.noteTitle,
        content: introData.snippet,
        score: 1.0,
        matchType: 'care_source',
        createdAt: new Date().toISOString()
      }] : [];

      // 更新本地状态
      setSessions(prev => {
        const updated = prev.map(s =>
          s.id === session!.id ? {
            ...s,
            messages: newMessages,
            relatedNotes: [...(s.relatedNotes || []), ...newRelatedNotes]
          } : s
        );

        persistChatSessions(userId, updated);
        return updated;
      });

      // 保存到数据库
      try {
        await saveSessionToDB(userId, {
          ...session,
          messages: newMessages,
          relatedNotes: [...(session.relatedNotes || []), ...newRelatedNotes]
        });
      } catch (error) {
        console.error('❌ 保存关怀消息失败:', error);
      }
    }
  };

  // 获取本地存储 & 请求服务器记录
  useEffect(() => {
    if (!userId) return;
    console.log('🟠 useEffect[userId] 触发, userId:', userId);
    const parsed = readChatSessionsFromStorage(userId);
    console.log('🟠 useEffect[userId] 本地 parsed:', parsed);

    // 只有在没有会话时，才设置本地存储的会话
    if (sessionsRef.current.length === 0 && parsed.length > 0) {
      setSessions(parsed);
    }

    // 如果当前正在创建新会话，则不加载服务器会话
    if (currentSessionIdRef.current && currentSessionIdRef.current.startsWith('local_')) {
      console.log('🟠 检测到正在创建新会话，跳过加载服务器会话');
      return;
    }
    
    // 添加防抖，避免频繁加载服务器会话
    const timer = setTimeout(() => {
      console.log('🟠 延迟加载服务器会话');
      loadSessionsFromDB(userId, parsed);
    }, 1000); // 延迟1秒加载
    
    return () => clearTimeout(timer); // 清除定时器
  }, [userId]);

  return {
    sessions,
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

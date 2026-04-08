'use client';

import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth';
import { IChat, IMessage, IRelatedNote, CareIntro } from '../types';

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

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // 自动切换当前会话
  useEffect(() => {
    if (sessions.length > 0) {
      const exists = sessions.some(s => s.id === currentSessionId);
      if (!currentSessionId || !exists) {
        const firstSession = sessions[0];
        // Prefer 'id', fallback to '_id'
        const firstId = firstSession.id || firstSession._id;
        if (firstId) {
          console.log('🔄 [useChatSession] 自动选中第一个会话:', firstId);
          setCurrentSessionId(firstId);
        }
      }
    }
  }, [sessions, currentSessionId]);

  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const saveSessionToDB = async (userId: string, session: IChat): Promise<string> => {
    try {
      const isLocalId = session.id.startsWith('local_');
      console.log('🟢 saveSessionToDB 开始保存会话:', session.id, '是本地ID:', isLocalId);
      
      const res = await authFetch('/api/chat/save', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: isLocalId ? undefined : session.id,
          title: session.title,
          messages: session.messages,
          relatedNotes: session.relatedNotes,
        }),
      });

      const data = await res.json();
      console.log('� saveSessionToDB 服务器返回:', data);

      const serverSessionId: string | undefined = data?.data?.sessionId || data?.sessionId;
      
      if (serverSessionId) {
        if (isLocalId && serverSessionId !== session.id) {
          console.log('🟢 saveSessionToDB 本地ID需要更新为服务器ID:', serverSessionId);
          
          setSessions(prevSessions => {
            const updated = prevSessions.map(s => 
              s.id === session.id ? { ...s, id: serverSessionId } : s
            );
            localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
            return updated;
          });
          
          if (currentSessionId === session.id) {
            console.log('🟢 saveSessionToDB 更新当前会话ID:', serverSessionId);
            setCurrentSessionId(serverSessionId);
          }
          
          return serverSessionId;
        }
      }
      
      return session.id;
    } catch (error) {
      console.error('❌ 保存会话失败:', error);
      return session.id;
    }
  };

  const removeSessionLocally = (sessionId: string) => {
    // Determine the next session ID *before* updating state, using the current 'sessions'
    // This is a bit tricky because 'sessions' might be stale if called rapidly, 
    // but for a UI action it's usually fine.
    const updated = sessions.filter((s) => s.id !== sessionId);
    
    setSessions(updated);
    
    if (userId) {
      localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
    }

    if (sessionId === currentSessionId) {
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

      const res = await authFetch(`/api/chat/${sessionId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        console.log('✅ 聊天记录已从服务器删除');
        removeSessionLocally(sessionId);
      } else {
        const error = await res.json();
        console.error('❌ 删除聊天记录失败:', error);
        throw new Error('删除失败，请稍后重试');
      }
    } catch (err) {
      console.error('❌ 删除聊天记录失败:', err);
      throw new Error('删除失败，请稍后重试');
    }
  };

  const startNewSession = async (userId: string): Promise<IChat> => {
    const localId = `local_${generateUUID()}`;
    console.log('🔵 startNewSession 生成本地ID:', localId);
    
    const newSession: IChat = {
      id: localId,
      title: '新对话',
      messages: [],
    };
    
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(localId);
    console.log('🔵 startNewSession 设置 currentSessionId:', localId);
    
    try {
      const savedId = await saveSessionToDB(userId, newSession);
      console.log('🔵 startNewSession 保存到数据库后返回的ID:', savedId);
      
      if (savedId && savedId !== localId) {
        console.log('🔵 startNewSession 更新本地ID为服务器ID:', savedId);
        // Note: saveSessionToDB already updates state if ID changes, 
        // but we return the updated session here.
        return { ...newSession, id: savedId };
      }
    } catch (error) {
      console.error('❌ 创建新会话失败:', error);
    }
    
    return newSession;
  };

  const loadSessionsFromDB = async (userId: string, localSessions: IChat[]) => {
    try {
      const res = await authFetch('/api/chat/sessions');
      const response = await res.json();
      console.log('� loadSessionsFromDB 服务端响应:', response);
      
      const serverSessions: IChat[] = response.success && response.data && response.data.sessions ? response.data.sessions : [];
      
      const normalizedServerSessions = serverSessions.map(s => ({
        ...s,
        id: s.id || s._id || ''
      })).filter(s => s.id !== '');

      setSessions(prevSessions => {
        const mergedSessionsMap = new Map<string, IChat>();

        normalizedServerSessions.forEach(s => {
          mergedSessionsMap.set(s.id, s);
        });

        const localSource = prevSessions.length > 0 ? prevSessions : localSessions;
        
        localSource.forEach(local => {
          const id = local.id || local._id;
          if (!id) return;

          const server = mergedSessionsMap.get(id);
          
          if (server) {
            // 完全信任服务端的 relatedNotes（后端已过滤被删除的笔记），不再受限于本地旧缓存
            const mergedNotes = server.relatedNotes || [];
            
            // 消息可以保留较长的一方，因为在发送消息瞬间本地可能多一条还没保存完的消息
            const mergedMessages = server.messages.length >= local.messages.length ? server.messages : local.messages;

            mergedSessionsMap.set(id, {
              ...server,
              messages: mergedMessages,
              relatedNotes: mergedNotes
            });
          } else if (id.startsWith('local_')) {
            mergedSessionsMap.set(id, local);
          }
        });

        const finalSessions = Array.from(mergedSessionsMap.values());
        
        localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(finalSessions));
        
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
        localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
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
      setSessions(prev => prev.map(s => 
        s.id === session!.id ? { 
          ...s, 
          messages: newMessages,
          relatedNotes: [...(s.relatedNotes || []), ...newRelatedNotes]
        } : s
      ));
      
      // 保存到数据库
      await saveSessionToDB(userId, { 
        ...session, 
        messages: newMessages,
        relatedNotes: [...(session.relatedNotes || []), ...newRelatedNotes]
      });
    }
  };

  // 获取本地存储 & 请求服务器记录
  useEffect(() => {
    if (!userId) return;
    console.log('🟠 useEffect[userId] 触发, userId:', userId);
    const storageKey = `chat_sessions_${userId}`;
    const local = localStorage.getItem(storageKey);
    const parsed: IChat[] = local ? JSON.parse(local) : [];
    console.log('🟠 useEffect[userId] 本地 parsed:', parsed);
    
    // 只有在没有会话时，才设置本地存储的会话
    if (sessions.length === 0 && parsed.length > 0) {
      setSessions(parsed);
    }

    // 如果当前正在创建新会话，则不加载服务器会话
    if (currentSessionId && currentSessionId.startsWith('local_')) {
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

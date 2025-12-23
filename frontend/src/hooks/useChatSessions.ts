/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useState, useEffect } from 'react';
import { authFetch } from '../utils/auth';

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
  _id?: string;
  title: string;
  messages: Message[];
}

interface UseChatSessionsReturn {
  sessions: ChatSession[];
  currentSessionId: string;
  currentSession: ChatSession | undefined;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string>>;
  loadSessionsFromDB: (userId: string, localSessions: ChatSession[]) => Promise<void>;
  startNewSession: (userId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionMessages: (sessionId: string, newMessages: Message[], userId?: string) => void;
  saveSessionToDB: (userId: string, session: ChatSession) => Promise<string>;
}

export const useChatSessions = (userId?: string): UseChatSessionsReturn => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const loadSessionsFromDB = async (userId: string, localSessions: ChatSession[]) => {
    try {
      const res = await authFetch('/api/chat/sessions');
      const response = await res.json();
      console.log('🟣 loadSessionsFromDB 服务端响应:', response);
      // 后端返回格式: {success: true, message: string, data: {sessions: ChatSession[]}}
      const serverSessions: ChatSession[] = response.success && response.data && response.data.sessions ? response.data.sessions : [];
      console.log('🟣 loadSessionsFromDB 提取的会话数据:', serverSessions);
      if (serverSessions && serverSessions.length > 0) {
        // 服务器数据优先，过滤掉本地重复会话
        const serverSessionIds = new Set(serverSessions.map((s: ChatSession) => s.id || (s as any)._id));
        // 过滤掉本地会话中与服务器重复的会话，并且过滤掉本地无效会话（如空消息会话）
        const filteredLocal = localSessions.filter(s => !serverSessionIds.has(s.id) && !(s as any)._id && s.messages.length > 0);
        const combined = [...serverSessions, ...filteredLocal];
        // 去重合并后的会话，防止重复
        const uniqueSessionsMap = new Map<string, ChatSession>();
        combined.forEach(session => {
          const id = session.id || (session as any)._id;
          if (!uniqueSessionsMap.has(id)) {
            uniqueSessionsMap.set(id, session);
          }
        });
        const uniqueSessions = Array.from(uniqueSessionsMap.values());
        console.log('🟣 loadSessionsFromDB 合并后的 uniqueSessions:', uniqueSessions);
        
        // 保存当前会话ID
        const currentId = currentSessionId;
        console.log('🟣 loadSessionsFromDB 更新前的 currentSessionId:', currentId);
        
        // 如果当前正在创建新会话，则不更新会话列表
        if (currentId && currentId.startsWith('local_')) {
          console.log('🟣 loadSessionsFromDB 检测到正在创建新会话，跳过更新会话列表');
          return;
        }
        
        // 保留当前会话的消息内容（使用现有 state sessions，而不是服务端列表）
        let currentSessionMessages: Message[] = [];
        if (currentId) {
          const existingCurrent = sessions.find(s => (s.id === currentId) || ((s as any)._id === currentId));
          if (existingCurrent) {
            currentSessionMessages = existingCurrent.messages;
          }
        }
        
        // 更新会话列表，但保留当前会话的消息内容
        setSessions(prevSessions => {
          // 如果有当前会话，确保保留其消息内容
          const updatedSessions = uniqueSessions.map(s => {
            if ((s.id === currentId) || ((s as any)._id === currentId)) {
              return { ...s, messages: currentSessionMessages.length > 0 ? currentSessionMessages : s.messages } as ChatSession;
            }
            return s as ChatSession;
          });
          
          // 更新本地存储
          localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updatedSessions));
          
          return updatedSessions;
        });
        
        // 如果当前没有选中的会话，或者当前选中的会话不在新的会话列表中，才设置为第一个会话
        if (!currentId || !uniqueSessions.some(s => ((s.id === currentId) || ((s as any)._id === currentId)))) {
          const newCurrentId = (uniqueSessions[0]?.id || (uniqueSessions[0] as any)?._id || '');
          console.log('🟣 loadSessionsFromDB 设置新的 currentSessionId:', newCurrentId);
          setCurrentSessionId(newCurrentId);
        } else {
          console.log('🟣 loadSessionsFromDB 保持当前 currentSessionId:', currentId);
        }
      }
    } catch (err) {
      console.error('❌ 获取聊天记录失败:', err);
    }
  };

  const startNewSession = async (userId: string) => {
    // 使用本地ID前缀，以便识别正在创建的新会话
    const localId = `local_${generateUUID()}`;
    console.log('🔵 startNewSession 生成本地ID:', localId);
    
    const newSession: ChatSession = {
      id: localId,
      title: '新对话',
      messages: [],
    };
    
    // 先在本地更新会话状态
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(localId);
    console.log('🔵 startNewSession 设置 currentSessionId:', localId);
    
    // 保存到数据库
    try {
      const savedId = await saveSessionToDB(userId, newSession);
      console.log('🔵 startNewSession 保存到数据库后返回的ID:', savedId);
      
      // 如果服务器返回的ID与本地ID不同，更新会话ID
      if (savedId && savedId !== localId) {
        console.log('🔵 startNewSession 更新本地ID为服务器ID:', savedId);
        setSessions(prev => prev.map(s => 
          s.id === localId ? { ...s, id: savedId } : s
        ));
        setCurrentSessionId(savedId);
        
        // 更新本地存储
        const updatedSessions = sessions.map(s => 
          s.id === localId ? { ...s, id: savedId } : s
        );
        localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updatedSessions));
      }
    } catch (error) {
      console.error('❌ 创建新会话失败:', error);
    }
  };

  const saveSessionToDB = async (userId: string, session: ChatSession): Promise<string> => {
    try {
      const isLocalId = session.id.startsWith('local_');
      console.log('🟢 saveSessionToDB 开始保存会话:', session.id, '是本地ID:', isLocalId);
      
      const res = await authFetch('/api/chat/save', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: isLocalId ? undefined : session.id, // 如果是本地ID，则不传给服务器
          title: session.title,
          messages: session.messages,
        }),
      });

      const data = await res.json();
      console.log('🟢 saveSessionToDB 服务器返回:', data);

      const serverSessionId: string | undefined = data && data.success && data.data && data.data.sessionId ? data.data.sessionId : data.sessionId;
      if (serverSessionId) {
        // 如果是本地ID，需要更新会话ID为服务器返回的ID
        if (isLocalId && serverSessionId !== session.id) {
          console.log('🟢 saveSessionToDB 本地ID需要更新为服务器ID:', serverSessionId);
          
          // 更新本地状态
          setSessions(prevSessions => {
            const updated = prevSessions.map(s => 
              s.id === session.id ? { ...s, id: serverSessionId } : s
            );
            
            // 更新本地存储
            localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
            
            return updated;
          });
          
          // 如果当前会话ID是被更新的会话ID，也需要更新currentSessionId
          if (currentSessionId === session.id) {
            console.log('🟢 saveSessionToDB 更新当前会话ID:', serverSessionId);
            setCurrentSessionId(serverSessionId);
          }
          
          return serverSessionId;
        }
      }
      
      return session.id; // 如果没有更新ID，则返回原ID
    } catch (error) {
      console.error('❌ 保存会话失败:', error);
      return session.id; // 出错时返回原ID
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      // 如果是本地会话，直接删除
      if (sessionId.startsWith('local_')) {
        removeSessionLocally(sessionId);
        return;
      }

      // 发送删除请求到服务器
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

  const removeSessionLocally = (sessionId: string) => {
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    if (userId) {
      localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
    }

    // 如果删除的是当前会话，切换到第一个会话
    if (sessionId === currentSessionId) {
      setCurrentSessionId(updated[0]?.id || '');
    }
  };

  const updateSessionMessages = (sessionId: string, newMessages: Message[], userId?: string) => {
    console.log('📝 updateSessionMessages 更新会话消息, sessionId:', sessionId, '新消息数量:', newMessages.length);
    
    // 创建一个新的会话数组，而不是直接修改原数组
    setSessions(prevSessions => {
      // 找到当前会话
      const sessionToUpdate = prevSessions.find(s => s.id === sessionId);
      if (!sessionToUpdate) {
        console.log('📝 updateSessionMessages 未找到会话:', sessionId);
        return prevSessions; // 如果找不到会话，返回原状态
      }
      
      // 更新会话消息
      const updated = prevSessions.map((s) =>
        s.id === sessionId ? { ...s, messages: newMessages } : s
      );
      console.log('📝 updateSessionMessages 更新后的sessions数量:', updated.length);
      
      // 更新本地存储
      if (userId) {
        localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
      }
      
      return updated;
    });
  };

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
  };
};
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

interface ChatRelatedNote {
  noteId: string;
  title?: string;
  content: string;
  score: number;
  matchType?: string;
  createdAt: string;
  reason?: string;
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
  relatedNotes?: ChatRelatedNote[];
}

interface UseChatSessionsReturn {
  sessions: ChatSession[];
  currentSessionId: string;
  currentSession: ChatSession | undefined;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string>>;
  loadSessionsFromDB: (userId: string, localSessions: ChatSession[]) => Promise<void>;
  startNewSession: (userId: string) => Promise<ChatSession>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionMessages: (sessionId: string, newMessages: Message[], userId?: string) => void;
  saveSessionToDB: (userId: string, session: ChatSession) => Promise<string>;
}

export const useChatSessions = (userId?: string): UseChatSessionsReturn => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // 自动切换当前会话：当列表更新且当前没有选中会话，或当前会话已不存在时
  useEffect(() => {
    if (sessions.length > 0) {
      const exists = sessions.some(s => s.id === currentSessionId);
      if (!currentSessionId || !exists) {
        const firstId = sessions[0].id || (sessions[0] as any)._id;
        console.log('🔄 [useChatSessions] 自动选中第一个会话:', firstId);
        setCurrentSessionId(firstId);
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

  const loadSessionsFromDB = async (userId: string, localSessions: ChatSession[]) => {
    try {
      const res = await authFetch('/api/chat/sessions');
      const response = await res.json();
      console.log('🟣 loadSessionsFromDB 服务端响应:', response);
      
      const serverSessions: ChatSession[] = response.success && response.data && response.data.sessions ? response.data.sessions : [];
      
      setSessions(prevSessions => {
        // 1. 建立一个以 ID 为键的 Map，用于高效合并
        const mergedSessionsMap = new Map<string, ChatSession>();

        // 2. 先填充服务器数据
        serverSessions.forEach(s => {
          const id = s.id || (s as any)._id;
          mergedSessionsMap.set(id, s);
        });

        // 3. 合并本地数据 (localSessions 来自 localStorage，prevSessions 来自当前运行状态)
        // 优先信任当前正在运行的状态 prevSessions，其次是 localStorage
        const localSource = prevSessions.length > 0 ? prevSessions : localSessions;
        
        localSource.forEach(local => {
          const id = local.id || (local as any)._id;
          const server = mergedSessionsMap.get(id);
          
          if (server) {
            // 如果两端都有，执行智能合并
            // 策略：优先保留本地的消息和相关笔记，除非服务器的版本更新（通过消息长度或笔记长度判断）
            const hasLocalNotes = local.relatedNotes && local.relatedNotes.length > 0;
            const hasServerNotes = server.relatedNotes && server.relatedNotes.length > 0;
            
            // 如果服务器没笔记但本地有，或者本地消息更长（说明有尚未同步的回复），则保留本地部分属性
            const mergedNotes = hasServerNotes ? server.relatedNotes : (hasLocalNotes ? local.relatedNotes : server.relatedNotes);
            const mergedMessages = server.messages.length >= local.messages.length ? server.messages : local.messages;

            mergedSessionsMap.set(id, {
              ...server,
              messages: mergedMessages,
              relatedNotes: mergedNotes
            });
          } else if (id.startsWith('local_')) {
            // 只有本地有的新会话，保留
            mergedSessionsMap.set(id, local);
          }
        });

        const finalSessions = Array.from(mergedSessionsMap.values());
        
        // 4. 更新当前选中会话的 ID
        // 注意：这里由于在 setSessions 内部，我们不能直接调用 setCurrentSessionId
        // 我们会在 useEffect 中处理 currentSessionId 的自动切换
        
        // 5. 持久化到本地存储
        localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(finalSessions));
        
        return finalSessions;
      });
    } catch (err) {
      console.error('❌ 获取聊天记录失败:', err);
    }
  };

  const startNewSession = async (userId: string): Promise<ChatSession> => {
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
        
        return { ...newSession, id: savedId };
      }
    } catch (error) {
      console.error('❌ 创建新会话失败:', error);
    }
    
    return newSession;
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
          relatedNotes: session.relatedNotes,
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
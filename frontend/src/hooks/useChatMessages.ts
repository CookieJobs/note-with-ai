'use client';

import { useState } from 'react';
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

interface UseChatMessagesReturn {
  loading: boolean;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  sendMessage: (
    input: string,
    currentSession: ChatSession,
    userId: string,
    updateSessionMessages: (sessionId: string, messages: Message[], userId?: string) => void,
    saveSessionToDB: (userId: string, session: ChatSession) => Promise<string>,
    setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>
  ) => Promise<void>;
  searchRelatedNotesAsync: (
    userMessage: string,
    aiReply: string,
    sessionId: string,
    messageIndex: number,
    userId: string,
    setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>,
    sessions: ChatSession[]
  ) => Promise<void>;
}

export const useChatMessages = (): UseChatMessagesReturn => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchRelatedNotesAsync = async (
    userMessage: string,
    aiReply: string,
    sessionId: string,
    messageIndex: number,
    userId: string,
    setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>,
    sessions: ChatSession[]
  ) => {
    try {
      console.log('🔍 开始异步搜索相关笔记...');
      
      // 先更新消息状态，显示搜索中的提示
      setSessions(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            const updatedMessages = [...session.messages];
            if (updatedMessages[messageIndex]) {
              updatedMessages[messageIndex] = {
                ...updatedMessages[messageIndex],
                searchingNotes: true
              };
            }
            return { ...session, messages: updatedMessages };
          }
          return session;
        });
      });

      const res = await authFetch('/api/chat/search-related-notes', {
        method: 'POST',
        body: JSON.stringify({ userMessage, aiReply }),
      });

      if (res.ok) {
        const data = await res.json();
        const relatedNotes = data.relatedNotes || [];
        
        console.log('📝 找到相关笔记:', relatedNotes.length, '条');

        // 更新消息，添加相关笔记
        setSessions(prevSessions => {
          return prevSessions.map(session => {
            if (session.id === sessionId) {
              const updatedMessages = [...session.messages];
              if (updatedMessages[messageIndex]) {
                updatedMessages[messageIndex] = {
                  ...updatedMessages[messageIndex],
                  relatedNotes: relatedNotes,
                  searchingNotes: false
                };
              }
              return { ...session, messages: updatedMessages };
            }
            return session;
          });
        });

        // 更新本地存储
        if (userId) {
          const updatedSessions = sessions.map(session => {
            if (session.id === sessionId) {
              const updatedMessages = [...session.messages];
              if (updatedMessages[messageIndex]) {
                updatedMessages[messageIndex] = {
                  ...updatedMessages[messageIndex],
                  relatedNotes: relatedNotes,
                  searchingNotes: false
                };
              }
              return { ...session, messages: updatedMessages };
            }
            return session;
          });
          localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updatedSessions));
        }
      } else {
        console.error('搜索相关笔记失败');
        // 移除搜索中状态
        setSessions(prevSessions => {
          return prevSessions.map(session => {
            if (session.id === sessionId) {
              const updatedMessages = [...session.messages];
              if (updatedMessages[messageIndex]) {
                updatedMessages[messageIndex] = {
                  ...updatedMessages[messageIndex],
                  searchingNotes: false
                };
              }
              return { ...session, messages: updatedMessages };
            }
            return session;
          });
        });
      }
    } catch (error) {
      console.error('搜索相关笔记出错:', error);
      // 移除搜索中状态
      setSessions(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            const updatedMessages = [...session.messages];
            if (updatedMessages[messageIndex]) {
              updatedMessages[messageIndex] = {
                ...updatedMessages[messageIndex],
                searchingNotes: false
              };
            }
            return { ...session, messages: updatedMessages };
          }
          return session;
        });
      });
    }
  };

  const sendMessage = async (
    input: string,
    currentSession: ChatSession,
    userId: string,
    updateSessionMessages: (sessionId: string, messages: Message[], userId?: string) => void,
    saveSessionToDB: (userId: string, session: ChatSession) => Promise<string>,
    setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>
  ) => {
    console.log('🚦 sendMessage 触发, input:', input, 'currentSession:', currentSession, 'loading:', loading);
    if (!input.trim()) {
      console.log('⚠️ 输入为空, 不发送');
      return;
    }
    if (!currentSession) {
      setError('当前会话不存在，无法发送消息');
      console.log('❌ currentSession 不存在, 无法发送');
      return;
    }
    if (!userId) {
      setError('用户未初始化，无法发送消息');
      console.log('❌ user 不存在, 无法发送');
      return;
    }

    // 确保消息的role严格为'user'或'assistant'
    const userMessage: Message = { role: 'user', content: input };
    const updatedMessages: Message[] = [...currentSession.messages, userMessage];

    // 先更新本地状态
    updateSessionMessages(currentSession.id, updatedMessages, userId);
    setLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: updatedMessages, sessionId: currentSession.id }),
      });
      
      if (!res.ok) {
        // 尝试解析错误信息
        try {
          const errorData = await res.json();
          throw new Error(errorData.error || '请求失败');
        } catch {
          throw new Error('请求失败');
        }
      }
      
      const data = await res.json();

      // 确保返回消息的role为'assistant'
      const assistantMessage: Message = { 
        role: 'assistant', 
        content: data.reply
      };
      const finalMessages: Message[] = [...updatedMessages, assistantMessage];

      // 更新本地状态
      updateSessionMessages(currentSession.id, finalMessages, userId);

      // 异步搜索相关笔记
      searchRelatedNotesAsync(
        userMessage.content, 
        assistantMessage.content, 
        currentSession.id, 
        finalMessages.length - 1,
        userId,
        setSessions,
        [] // 这里需要传入当前的sessions，但由于闭包问题，我们在调用时会处理
      );

      // 自动摘要并更新会话标题
      try {
        const summaryRes = await authFetch('/api/chat/summarizeTitle', {
          method: 'POST',
          body: JSON.stringify({
            userContent: userMessage.content,
            aiContent: assistantMessage.content
          })
        });
        if (summaryRes.ok) {
          const { title } = await summaryRes.json();
          // 更新会话标题
          setSessions(prevSessions => {
            const updated = prevSessions.map(s =>
              s.id === currentSession.id ? { ...s, title } : s
            );
            // 更新本地存储
            if (userId) {
              localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
            }
            return updated;
          });
          
          // 保存到数据库
          const newSessionId = await saveSessionToDB(userId, { ...currentSession, messages: finalMessages, title });
          console.log('🚦 sendMessage 保存会话后返回的ID:', newSessionId);
        } else {
          // 摘要失败也要保存消息
          const newSessionId = await saveSessionToDB(userId, { ...currentSession, messages: finalMessages });
          console.log('🚦 sendMessage 保存会话后返回的ID:', newSessionId);
        }
      } catch (e) {
        const newSessionId = await saveSessionToDB(userId, { ...currentSession, messages: finalMessages });
        console.log('🚦 sendMessage 保存会话后返回的ID:', newSessionId);
      }
    } catch (err: any) {
      console.error('发送消息失败:', err);
      // 显示具体的错误信息
      setError(err.message || '发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    setError,
    sendMessage,
    searchRelatedNotesAsync,
  };
};
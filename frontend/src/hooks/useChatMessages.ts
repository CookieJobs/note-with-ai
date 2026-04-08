/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
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
  relatedNotes?: RelatedNote[]; // Legacy support, or remove if unused
  searchingNotes?: boolean;
}

interface ChatSession {
  id: string;
  _id?: string;
  title: string;
  messages: Message[];
  relatedNotes?: ChatRelatedNote[];
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
  updateContextRelatedNotes: (
    sessionId: string,
    messages: Message[],
    userId: string,
    setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>,
    saveSessionToDB: (userId: string, session: ChatSession) => Promise<string>
  ) => Promise<void>;
}

export const useChatMessages = (): UseChatMessagesReturn => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const updateContextRelatedNotes = async (
    sessionId: string,
    messages: Message[],
    userId: string,
    setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>,
    saveSessionToDB: (userId: string, session: ChatSession) => Promise<string>
  ) => {
    try {
      console.log('🔍 开始异步搜索会话相关笔记...');

      const res = await authFetch('/api/chat/context-related-notes', {
        method: 'POST',
        body: JSON.stringify({ messages }),
      });

      if (res.ok) {
        const data = await res.json();
        const relatedNotes: ChatRelatedNote[] = (data && data.data && Array.isArray(data.data.relatedNotes) ? data.data.relatedNotes : (data.relatedNotes || []));

        console.log('📝 找到会话相关笔记:', relatedNotes.length, '条');

        let updatedSession: ChatSession | undefined;

        // 更新会话状态
        setSessions(prevSessions => {
          const updatedSessions = prevSessions.map(session => {
            if (session.id === sessionId) {
              updatedSession = { ...session, relatedNotes };
              return updatedSession;
            }
            return session;
          });

          // 更新本地存储
          if (userId) {
            localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updatedSessions));
          }

          return updatedSessions;
        });

        // 持久化到数据库
        if (updatedSession) {
          console.log('💾 保存相关笔记到数据库...');
          await saveSessionToDB(userId, updatedSession);
        }
      } else {
        console.error('搜索会话相关笔记失败');
      }
    } catch (error) {
      console.error('搜索会话相关笔记出错:', error);
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
    console.log('🚦 sendMessage 触发 (流式), input:', input, 'currentSession:', currentSession, 'loading:', loading);
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
      const serverSessionId = currentSession.id.startsWith('local_') ? undefined : currentSession.id;
      const res = await authFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: updatedMessages, sessionId: serverSessionId }),
      });

      if (!res.ok) {
        // 尝试解析错误信息
        try {
          const errorData = await res.json();
          throw new Error(errorData.error || errorData.message || '请求失败');
        } catch {
          throw new Error('请求失败');
        }
      }

      // 处理流式响应
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let assistantReply = '';

      // 先在 UI 中添加一个空的 assistant 消息占位
      const initialAssistantMessage: Message = { role: 'assistant', content: '' };
      let currentMessages = [...updatedMessages, initialAssistantMessage];
      updateSessionMessages(currentSession.id, currentMessages, userId);

      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 最后一行可能不完整，保留在 buffer 中

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            // 使用正则更稳健地匹配 SSE 数据行
            const match = trimmedLine.match(/^data:\s*(.*)$/);
            if (!match) continue;

            const dataStr = match[1].trim();
            if (dataStr === '[DONE]') break;

            try {
              const data = JSON.parse(dataStr);
              if (data.chunk) {
                // 每收到一个 chunk 立即更新 UI，实现真正的流式输出
                assistantReply += data.chunk;
                currentMessages = [
                  ...updatedMessages,
                  { role: 'assistant', content: assistantReply }
                ];
                updateSessionMessages(currentSession.id, currentMessages, userId);
              } else if (data.error) {
                throw new Error(data.error);
              }
            } catch (e: any) {
              if (dataStr.includes('"error":')) {
                throw e;
              }
              console.warn('SSE 解析警告:', e.message, '数据:', dataStr);
            }
          }
        }
      } finally {
        // 流读取完毕
      }


      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantReply
      };
      const finalMessages: Message[] = [...updatedMessages, assistantMessage];

      // 异步搜索会话相关笔记
      updateContextRelatedNotes(
        currentSession.id,
        finalMessages,
        userId,
        setSessions,
        saveSessionToDB
      );

      // 自动摘要并更新会话标题
      try {
        const userText = (userMessage.content || '').trim();
        const aiText = assistantReply.trim();

        if (userText && aiText) {
          const summaryRes = await authFetch('/api/chat/summarizeTitle', {
            method: 'POST',
            body: JSON.stringify({
              userContent: userText,
              aiContent: aiText
            })
          });
          if (summaryRes.ok) {
            const summaryData = await summaryRes.json();
            const title: string = (summaryData && summaryData.data && typeof summaryData.data.title === 'string') ? summaryData.data.title : summaryData.title;
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
            const sessionToSave = { ...currentSession, messages: finalMessages, title };
            delete sessionToSave.relatedNotes;

            const newSessionId = await saveSessionToDB(userId, sessionToSave);
            console.log('🚦 sendMessage 保存会话后返回的ID:', newSessionId);
          } else {
            // 摘要失败也要保存消息
            const sessionToSave = { ...currentSession, messages: finalMessages };
            delete sessionToSave.relatedNotes;

            const newSessionId = await saveSessionToDB(userId, sessionToSave);
            console.log('🚦 sendMessage 保存会话后返回的ID:', newSessionId);
          }
        } else {
          // 内容为空，跳过标题摘要但依然保存消息
          const sessionToSave = { ...currentSession, messages: finalMessages };
          delete sessionToSave.relatedNotes;

          const newSessionId = await saveSessionToDB(userId, sessionToSave);
          console.log('🚦 sendMessage（跳过摘要）保存会话后返回的ID:', newSessionId);
        }
      } catch (e) {
        const sessionToSave = { ...currentSession, messages: finalMessages };
        delete sessionToSave.relatedNotes;

        const newSessionId = await saveSessionToDB(userId, sessionToSave);
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
    updateContextRelatedNotes,
  };
};
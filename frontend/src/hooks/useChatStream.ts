'use client';

import { useRef, useState } from 'react';
import { authFetch } from '../utils/auth';
import { IChat, IMessage, IRelatedNote } from '../types';
import { persistChatSessions, replaceSessionId } from './chatSessionStore';

interface UseChatStreamReturn {
  loading: boolean;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  sendMessage: (
    input: string,
    currentSession: IChat,
    userId: string,
    updateSessionMessages: (sessionId: string, messages: IMessage[], userId?: string) => void,
    saveSessionToDB: (userId: string, session: IChat) => Promise<string>,
    setSessions: React.Dispatch<React.SetStateAction<IChat[]>>
  ) => Promise<void>;
  updateContextRelatedNotes: (
    messages: IMessage[]
  ) => Promise<IRelatedNote[] | undefined>;
}

export const useChatStream = (): UseChatStreamReturn => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadingRef = useRef(false);

  const fetchSummaryTitle = async (userContent: string, aiContent: string): Promise<string | undefined> => {
    try {
      const response = await authFetch('/api/chat/summarizeTitle', {
        method: 'POST',
        body: JSON.stringify({
          userContent,
          aiContent,
        })
      });

      if (!response.ok) {
        return undefined;
      }

      const summaryData = await response.json();
      return (summaryData && summaryData.data && typeof summaryData.data.title === 'string')
        ? summaryData.data.title
        : summaryData.title;
    } catch (err) {
      console.error('摘要生成失败:', err);
      return undefined;
    }
  };

  const updateContextRelatedNotes = async (
    messages: IMessage[]
  ): Promise<IRelatedNote[] | undefined> => {
    try {
      console.log('🔍 开始异步搜索会话相关笔记...');

      const res = await authFetch('/api/chat/context-related-notes', {
        method: 'POST',
        body: JSON.stringify({ messages }),
      });

      if (res.ok) {
        const data = await res.json();
        const relatedNotes: IRelatedNote[] = (data && data.data && Array.isArray(data.data.relatedNotes) ? data.data.relatedNotes : (data.relatedNotes || []));

        console.log('📝 找到会话相关笔记:', relatedNotes.length, '条');
        return relatedNotes;
      } else {
        console.error('搜索会话相关笔记失败');
        return undefined;
      }
    } catch (error) {
      console.error('搜索会话相关笔记出错:', error);
      return undefined;
    }
  };

  const sendMessage = async (
    input: string,
    currentSession: IChat,
    userId: string,
    updateSessionMessages: (sessionId: string, messages: IMessage[], userId?: string) => void,
    saveSessionToDB: (userId: string, session: IChat) => Promise<string>,
    setSessions: React.Dispatch<React.SetStateAction<IChat[]>>
  ) => {
    console.log('🚦 sendMessage 触发 (流式), input:', input, 'currentSession:', currentSession, 'loading:', loading);
    if (loadingRef.current) {
      console.log('⚠️ 正在发送中，忽略重复请求');
      return;
    }
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
    const userMessage: IMessage = { role: 'user', content: input };
    const updatedMessages: IMessage[] = [...currentSession.messages, userMessage];

    // 先更新本地状态
    updateSessionMessages(currentSession.id, updatedMessages, userId);
    loadingRef.current = true;
    setLoading(true);
    setError('');

    try {
      const serverSessionId = currentSession.id.startsWith('local_') ? undefined : currentSession.id;
      const res = await authFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: updatedMessages, sessionId: serverSessionId }),
      });

      if (!res.ok) {
        let errorMessage = '请求失败';
        try {
          const errorData = await res.json();
          if (errorData?.error) errorMessage = errorData.error;
          else if (errorData?.message) errorMessage = errorData.message;
        } catch {
          // JSON 解析失败，使用默认错误消息
        }
        throw new Error(errorMessage);
      }

      // 处理流式响应
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let assistantReply = '';
      let resolvedSessionId = currentSession.id;

      // 先在 UI 中添加一个空的 assistant 消息占位
      const initialAssistantMessage: IMessage = { role: 'assistant', content: '' };
      let currentMessages = [...updatedMessages, initialAssistantMessage];
      updateSessionMessages(currentSession.id, currentMessages, userId);

      let buffer = '';
      let shouldStop = false;
      try {
        while (!shouldStop) {
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
            if (dataStr === '[DONE]') {
              shouldStop = true;
              break;
            }

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
              } else if (data.type === 'meta' && typeof data.sessionId === 'string') {
                resolvedSessionId = data.sessionId;
              } else if (data.error) {
                shouldStop = true;
                throw new Error(data.error);
              }
            } catch (e: unknown) {
              if (dataStr.includes('"error":')) {
                shouldStop = true;
                throw e;
              }
              console.warn('SSE 解析警告:', e instanceof Error ? e.message : e, '数据:', dataStr);
            }
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {}
        try {
          reader.releaseLock();
        } catch {}
      }


      const assistantMessage: IMessage = {
        role: 'assistant',
        content: assistantReply
      };
      const finalMessages: IMessage[] = [...updatedMessages, assistantMessage];

      const baseSessionToSave: IChat = {
        ...currentSession,
        id: resolvedSessionId,
        messages: finalMessages,
      };

      setSessions(prevSessions => {
        const idAligned = resolvedSessionId !== currentSession.id
          ? replaceSessionId(prevSessions, currentSession.id, resolvedSessionId)
          : prevSessions;
        const hasSession = idAligned.some(s => s.id === resolvedSessionId);
        const updated = hasSession
          ? idAligned.map(s => {
              if (s.id !== resolvedSessionId) return s;
              return { ...s, id: resolvedSessionId, messages: finalMessages };
            })
          : [{ ...baseSessionToSave }, ...idAligned];

        persistChatSessions(userId, updated);
        return updated;
      });

      void (async () => {
        const userText = (userMessage.content || '').trim();
        const aiText = assistantReply.trim();

        const fetchNotesPromise = updateContextRelatedNotes(finalMessages);
        const fetchTitlePromise = userText && aiText
          ? fetchSummaryTitle(userText, aiText)
          : Promise.resolve(undefined);

        const [notesResult, titleResult] = await Promise.allSettled([
          fetchNotesPromise,
          fetchTitlePromise
        ]);

        const newRelatedNotes = notesResult.status === 'fulfilled' ? notesResult.value : undefined;
        const newTitle = titleResult.status === 'fulfilled' ? titleResult.value : undefined;

        if (!newTitle && !newRelatedNotes) {
          return;
        }

        const enrichedSession: IChat = {
          ...baseSessionToSave,
          ...(newTitle && { title: newTitle }),
          ...(newRelatedNotes && { relatedNotes: newRelatedNotes })
        };

        setSessions(prevSessions => {
          const hasSession = prevSessions.some(s => s.id === resolvedSessionId);
          const updated = hasSession
            ? prevSessions.map(s => {
                if (s.id !== resolvedSessionId) return s;
                return {
                  ...s,
                  ...(newTitle && { title: newTitle }),
                  ...(newRelatedNotes && { relatedNotes: newRelatedNotes }),
                };
              })
            : [enrichedSession, ...prevSessions];

          persistChatSessions(userId, updated);
          return updated;
        });

        try {
          const newSessionId = await saveSessionToDB(userId, enrichedSession);
          console.log('🚦 sendMessage 最终保存会话后返回的ID:', newSessionId);
        } catch (saveErr) {
          console.error('🚦 sendMessage 保存会话失败:', saveErr);
          setError(saveErr instanceof Error ? saveErr.message : '保存会话失败');
        }
      })().catch((backgroundError) => {
        console.error('🚦 sendMessage 后台更新会话失败:', backgroundError);
      });
    } catch (err: unknown) {
      console.error('发送消息失败:', err);
      // 显示具体的错误信息
      setError(err instanceof Error ? err.message : '发送失败，请稍后重试');
    } finally {
      loadingRef.current = false;
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

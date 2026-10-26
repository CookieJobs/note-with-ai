'use client';

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../utils/auth';
import { IChat, IMessage } from '../types';
import { persistChatSessions, replaceSessionId } from './chatSessionStore';

interface UseChatStreamReturn {
  loading: boolean;
  activeSessionId: string | null;
  errorSessionId: string | null;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  sendMessage: (
    input: string,
    currentSession: IChat,
    userId: string,
    updateSessionMessages: (sessionId: string, messages: IMessage[], userId?: string) => void,
    setSessions: React.Dispatch<React.SetStateAction<IChat[]>>,
    onAccepted?: () => void,
  ) => Promise<boolean>;
}

const CHAT_IDLE_TIMEOUT_MS = 60_000;
const CHAT_TOTAL_TIMEOUT_MS = 180_000;

function getChatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/CHAT_IDLE_TIMEOUT|CHAT_TOTAL_TIMEOUT|timed? out|timeout/i.test(message)) {
    return '等待回复超时，请重试；你的问题已保留。';
  }
  if (/CHAT_UNCOMMITTED|尚未完成保存|未保存/.test(message)) {
    return '回答尚未完成保存，请重试；你的问题已保留。';
  }
  if (/AI_SERVICE_UNAVAILABLE|MODEL_SERVICE_UNAVAILABLE/i.test(message)) {
    return 'AI 服务暂不可用，请稍后重试；你的问题已保留。';
  }
  if (/^AI\s*服务暂不可用/.test(message.trim())) {
    return 'AI 服务暂不可用，请稍后重试；你的问题已保留。';
  }
  if (/^AI\s*服务(?:连接失败|限流|认证失败|响应超时)/.test(message.trim())) {
    return /请重试|请稍后/.test(message) ? message : `${message}，请重试；你的问题已保留。`;
  }
  if (/来源笔记|笔记已删除|笔记不存在|检查权限/.test(message)) return message;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(message.trim()) || /internal server error/i.test(message)) {
    return 'AI 服务暂不可用，请稍后重试；你的问题已保留。';
  }
  return message || '发送失败，请稍后重试';
}

type CommittedSessionPayload = IChat & {
  _id?: string;
};

export const useChatStream = (
  onSessionIdChange?: (previousId: string, nextId: string) => void,
): UseChatStreamReturn => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [errorSessionId, setErrorSessionId] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isAbortError = (err: unknown): boolean => {
    if (err instanceof DOMException) return err.name === 'AbortError';
    if (!(err instanceof Error)) return false;
    return err.name === 'AbortError' || /aborted|abort/i.test(err.message);
  };

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const applyCommittedSession = (
    previousSessionId: string,
    session: CommittedSessionPayload,
    userId: string,
    setSessions: React.Dispatch<React.SetStateAction<IChat[]>>,
  ) => {
    const nextSessionId = session.id || session._id || previousSessionId;
    const committedSession: IChat = {
      ...session,
      id: nextSessionId,
      _id: session._id || nextSessionId,
    };

    setSessions((prevSessions) => {
      const withIdSynced = nextSessionId !== previousSessionId
        ? replaceSessionId(prevSessions, previousSessionId, nextSessionId)
        : prevSessions;
      const sessionExists = withIdSynced.some((item) => item.id === nextSessionId);
      const updated = sessionExists
        ? withIdSynced.map((item) => (item.id === nextSessionId ? committedSession : item))
        : [committedSession, ...withIdSynced];

      persistChatSessions(userId, updated);
      return updated;
    });
  };

  const sendMessage = async (
    input: string,
    currentSession: IChat,
    userId: string,
    updateSessionMessages: (sessionId: string, messages: IMessage[], userId?: string) => void,
    setSessions: React.Dispatch<React.SetStateAction<IChat[]>>,
    onAccepted?: () => void,
  ) => {
    if (loadingRef.current) {
      return false;
    }
    if (!input.trim()) {
      return false;
    }
    if (!currentSession) {
      setError('当前会话不存在，无法发送消息');
      return false;
    }
    if (!userId) {
      setError('用户未初始化，无法发送消息');
      return false;
    }

    // 确保消息的role严格为'user'或'assistant'
    const userMessage: IMessage = { role: 'user', content: input };
    const lastMessage = currentSession.messages.at(-1);
    // An unanswered trailing question is retained after failure; retry it once.
    const updatedMessages: IMessage[] = lastMessage?.role === 'user' && lastMessage.content === input
      ? currentSession.messages
      : [...currentSession.messages, userMessage];

    // 先更新本地状态
    updateSessionMessages(currentSession.id, updatedMessages, userId);
    loadingRef.current = true;
    setLoading(true);
    setActiveSessionId(currentSession.id);
    setErrorSessionId(null);
    setError('');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let hasCommittedSession = false;
    let effectiveSessionId = currentSession.id;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutCode: string | null = null;
    let rejectTimeout!: (error: Error) => void;
    const timeoutPromise = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const refreshIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timeoutCode = 'CHAT_IDLE_TIMEOUT';
        abortController.abort();
        rejectTimeout(new Error(timeoutCode));
      }, CHAT_IDLE_TIMEOUT_MS);
    };
    refreshIdleTimer();
    totalTimer = setTimeout(() => {
      timeoutCode = 'CHAT_TOTAL_TIMEOUT';
      abortController.abort();
      rejectTimeout(new Error(timeoutCode));
    }, CHAT_TOTAL_TIMEOUT_MS);
    let finished = false;

    const streamOperation = async (): Promise<boolean> => {
      const serverSessionId = currentSession.id.startsWith('local_') ? undefined : currentSession.id;
      const res = await authFetch('/api/chat', {
        method: 'POST',
        signal: abortController.signal,
        body: JSON.stringify({
          messages: updatedMessages.map(({ sourceSnapshot: _sourceSnapshot, ...message }) => message),
          sessionId: serverSessionId,
          sourceNoteId: currentSession.sourceNoteId,
        }),
      });
      if (finished) return false;

      if (!res.ok) {
        let errorMessage = '请求失败';
        try {
          const errorData = await res.json();
          errorMessage = errorData?.error || errorData?.message || errorMessage;
        } catch {}
        throw new Error(errorMessage);
      }

      // 处理流式响应
      reader = res.body?.getReader() ?? null;
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let assistantReply = '';

      // 先在 UI 中添加一个空的 assistant 消息占位
      const initialAssistantMessage: IMessage = { role: 'assistant', content: '' };
      let currentMessages = [...updatedMessages, initialAssistantMessage];
      updateSessionMessages(effectiveSessionId, currentMessages, userId);

      let buffer = '';
      let shouldStop = false;
      while (!shouldStop && !hasCommittedSession && !finished) {
        const { done, value } = await reader.read();
        if (finished) return false;
        if (done) break;
        if (value?.byteLength) refreshIdleTimer();

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

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataStr);
          } catch {
            // Ignore malformed SSE frames without logging their contents.
            continue;
          }
          if (typeof data.error === 'string') {
            shouldStop = true;
            throw new Error(data.error);
          }
          if (data.chunk && !hasCommittedSession) {
            // 每收到一个 chunk 立即更新 UI，实现真正的流式输出
            assistantReply += data.chunk;
            currentMessages = [
              ...updatedMessages,
              { role: 'assistant', content: assistantReply }
            ];
            updateSessionMessages(effectiveSessionId, currentMessages, userId);
          } else if (data.type === 'committed' && data.session && typeof data.session === 'object') {
            const nextSession = data.session as CommittedSessionPayload;
            const committedSessionId = nextSession.id || nextSession._id || effectiveSessionId;
            applyCommittedSession(effectiveSessionId, nextSession, userId, setSessions);
            hasCommittedSession = true;
            if (committedSessionId !== effectiveSessionId) {
              onSessionIdChange?.(effectiveSessionId, committedSessionId);
            }
            effectiveSessionId = committedSessionId;
            shouldStop = true;
            break;
          }
        }
      }
      if (!hasCommittedSession) throw new Error('CHAT_UNCOMMITTED');
      return true;
    };

    try {
      onAccepted?.();
      return await Promise.race([streamOperation(), timeoutPromise]);
    } catch (err: unknown) {
      setErrorSessionId(effectiveSessionId);
      if (!hasCommittedSession) {
        updateSessionMessages(effectiveSessionId, updatedMessages, userId);
      }
      if (isAbortError(err)) {
        if (timeoutCode) setError(getChatErrorMessage(new Error(timeoutCode)));
        return false;
      }
      setError(getChatErrorMessage(err));
      return false;
    } finally {
      finished = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      if (reader) {
        void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch {}
      }
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      loadingRef.current = false;
      setLoading(false);
      setActiveSessionId(null);
    }
  };

  return {
    loading,
    activeSessionId,
    errorSessionId,
    error,
    setError,
    sendMessage,
  };
};

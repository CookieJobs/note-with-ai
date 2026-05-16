'use client';

import { authFetch } from '../utils/auth';
import { IChat } from '../types';

export const getChatSessionsStorageKey = (userId: string) => `chat_sessions_${userId}`;

export const readChatSessionsFromStorage = (userId: string): IChat[] => {
  const local = localStorage.getItem(getChatSessionsStorageKey(userId));
  if (!local) return [];

  try {
    const parsed = JSON.parse(local);
    return Array.isArray(parsed) ? normalizeChatSessions(parsed) : [];
  } catch (error) {
    console.error('❌ 解析本地聊天会话失败:', error);
    return [];
  }
};

export const persistChatSessions = (userId: string, sessions: IChat[]) => {
  localStorage.setItem(getChatSessionsStorageKey(userId), JSON.stringify(sessions));
};

export const createLocalSessionId = () =>
  `local_${'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  })}`;

export const normalizeChatSession = (session: Partial<IChat>): IChat | null => {
  const id = session.id || session._id || '';
  if (!id) return null;

  return {
    ...session,
    id,
    title: session.title || '新对话',
    messages: Array.isArray(session.messages) ? session.messages : [],
    relatedNotes: Array.isArray(session.relatedNotes) ? session.relatedNotes : undefined,
  } as IChat;
};

export const normalizeChatSessions = (sessions: Partial<IChat>[]): IChat[] =>
  sessions
    .map(normalizeChatSession)
    .filter((session): session is IChat => session !== null);

export const mergeChatSessions = (serverSessions: IChat[], localSessions: IChat[]): IChat[] => {
  const mergedSessionsMap = new Map<string, IChat>();

  serverSessions.forEach((session) => {
    mergedSessionsMap.set(session.id, session);
  });

  localSessions.forEach((localSession) => {
    const sessionId = localSession.id || localSession._id;
    if (!sessionId) return;

    const serverSession = mergedSessionsMap.get(sessionId);
    if (serverSession) {
      const serverNotes = Array.isArray(serverSession.relatedNotes) ? serverSession.relatedNotes : [];
      const localNotes = Array.isArray(localSession.relatedNotes) ? localSession.relatedNotes : [];
      mergedSessionsMap.set(sessionId, {
        ...serverSession,
        messages: serverSession.messages.length >= localSession.messages.length
          ? serverSession.messages
          : localSession.messages,
        relatedNotes: serverNotes.length >= localNotes.length ? serverNotes : localNotes,
      });
      return;
    }

    if (sessionId.startsWith('local_')) {
      mergedSessionsMap.set(sessionId, localSession);
    }
  });

  return Array.from(mergedSessionsMap.values());
};

export const saveChatSessionRemote = async (session: IChat): Promise<string | undefined> => {
  const isLocalId = session.id.startsWith('local_');
  const response = await authFetch('/api/chat/save', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: isLocalId ? undefined : session.id,
      title: session.title,
      messages: session.messages,
      relatedNotes: session.relatedNotes,
    }),
  });

  const data = await response.json().catch(() => undefined);
  console.log('🟢 saveChatSessionRemote 服务器返回:', data);

  if (!response.ok) {
    throw new Error(data?.error || data?.message || '保存会话失败');
  }

  return data?.data?.sessionId || data?.sessionId;
};

export const fetchChatSessionsRemote = async (): Promise<IChat[]> => {
  const response = await authFetch('/api/chat/sessions');
  const payload = await response.json().catch(() => undefined);
  console.log('🟣 fetchChatSessionsRemote 服务端响应:', payload);

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || '获取聊天记录失败');
  }

  const serverSessions: IChat[] = payload.success && payload.data && payload.data.sessions
    ? payload.data.sessions
    : [];

  return normalizeChatSessions(serverSessions);
};

export const deleteChatSessionRemote = async (sessionId: string): Promise<void> => {
  const response = await authFetch(`/api/chat/${sessionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => undefined);
    console.error('❌ 删除聊天记录失败:', error);
    throw new Error('删除失败，请稍后重试');
  }
};

export const replaceSessionId = (sessions: IChat[], fromId: string, toId: string): IChat[] =>
  sessions.map((session) => (
    session.id === fromId
      ? { ...session, id: toId }
      : session
  ));

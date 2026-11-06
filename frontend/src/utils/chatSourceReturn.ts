export interface ChatSourceReturn {
  userId: string;
  sessionId: string;
  sessionTitle?: string;
  scrollTop: number;
  draft: string;
  savedAt: number;
}

const storageKey = (userId: string) => `chat_source_return:${userId}`;

export function rememberChatSourceReturn(context: Omit<ChatSourceReturn, 'savedAt'>): void {
  try {
    sessionStorage.setItem(storageKey(context.userId), JSON.stringify({ ...context, savedAt: Date.now() }));
  } catch {
    // A storage failure must not prevent opening the source note.
  }
}

// Notes may inspect this across multiple visits; only the chat page consumes it.
export function readChatSourceReturn(userId: string): ChatSourceReturn | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const context = value as Partial<ChatSourceReturn>;
    if (context.userId !== userId || typeof context.sessionId !== 'string' || !context.sessionId
      || (context.sessionTitle !== undefined && typeof context.sessionTitle !== 'string')
      || typeof context.draft !== 'string' || typeof context.scrollTop !== 'number'
      || !Number.isFinite(context.scrollTop) || context.scrollTop < 0
      || typeof context.savedAt !== 'number' || !Number.isFinite(context.savedAt)
      || Date.now() - context.savedAt < 0 || Date.now() - context.savedAt > 30 * 60 * 1000) return null;
    return context as ChatSourceReturn;
  } catch {
    return null;
  }
}

export function takeChatSourceReturn(userId: string): ChatSourceReturn | null {
  const context = readChatSourceReturn(userId);
  try {
    sessionStorage.removeItem(storageKey(userId));
  } catch {
    return null;
  }
  return context;
}

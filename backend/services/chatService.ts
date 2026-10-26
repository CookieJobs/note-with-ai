import Chat from '../models/Chat';
import { Note } from '../models/Note';
import { IChat, IMessage, IRelatedNote } from '../types';
import { ErrorHandler } from '../utils/errorHandler';
import { chatWithDeepSeekStream, summarizeChatTitle, chatWithDeepSeek } from './llmService';
import { AiUsageService } from './aiUsageService';
import mongoose from 'mongoose';
import { sourceMetadata } from './noteSourceMetadata';
import { buildChatModelMessages, loadChatNoteSource } from './chatNoteContextService';
import type { ChatSourceSnapshot } from '../types/chatSource';

type SaveSessionOptions = {
  sourceNoteId?: string;
  trustedSourceSnapshots?: boolean;
};

type PreparedChatTurn = {
  messages: IMessage[];
  sourceNoteId?: string;
  sourceSnapshot?: ChatSourceSnapshot;
};

function cleanMessages(messages: IMessage[], trusted = false): IMessage[] {
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim(),
      ...(trusted && m.role === 'assistant' && m.sourceSnapshot ? { sourceSnapshot: m.sourceSnapshot } : {}),
    }));
}

type RelatedNoteRecord = Omit<IRelatedNote, 'noteId'> & {
  noteId: string | { _id?: string | null } | null;
};

type ChatSessionRecord = {
  _id: { toString(): string } | string;
  relatedNotes?: RelatedNoteRecord[];
  [key: string]: unknown;
};

type ChatSessionSource = ChatSessionRecord & {
  toObject?: () => Record<string, unknown>;
};

function normalizeRelatedNotes(relatedNotes?: unknown): IRelatedNote[] | undefined {
  if (!Array.isArray(relatedNotes)) return undefined;

  return relatedNotes
    .map((note) => {
      const noteRecord = typeof note === 'object' && note !== null
        ? note as Record<string, unknown>
        : {};
      const rawNoteId = typeof note === 'string'
        ? note
        : (noteRecord.noteId || noteRecord.id);
      const noteId = String(rawNoteId || '');
      if (!mongoose.Types.ObjectId.isValid(noteId)) return null;

      const rawCreatedAt = noteRecord.createdAt;
      const createdAt = rawCreatedAt ? new Date(String(rawCreatedAt)) : undefined;
      const isLegacyCareDate = noteRecord.matchType === 'care_source' && noteRecord.createdAtSource !== 'note';
      const score = typeof noteRecord.score === 'number'
        ? noteRecord.score
        : (typeof noteRecord.similarity === 'number' ? noteRecord.similarity : undefined);

      return {
        noteId: new mongoose.Types.ObjectId(noteId),
        title: typeof noteRecord.title === 'string' ? noteRecord.title : undefined,
        content: typeof noteRecord.content === 'string' ? noteRecord.content : undefined,
        excerpt: typeof noteRecord.excerpt === 'string' ? noteRecord.excerpt : undefined,
        sourceType: ['text', 'image', 'mixed'].includes(String(noteRecord.sourceType)) ? noteRecord.sourceType : undefined,
        imageCount: typeof noteRecord.imageCount === 'number' ? noteRecord.imageCount : undefined,
        firstImageSrc: typeof noteRecord.firstImageSrc === 'string' ? noteRecord.firstImageSrc : undefined,
        createdAtSource: noteRecord.createdAtSource === 'note' ? 'note' : undefined,
        score,
        matchType: typeof noteRecord.matchType === 'string' ? noteRecord.matchType : undefined,
        reason: typeof noteRecord.reason === 'string' ? noteRecord.reason : undefined,
        createdAt: !isLegacyCareDate && createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
      } as IRelatedNote;
    })
    .filter((note): note is IRelatedNote => note !== null);
}

function normalizeSessionRecord(session: ChatSessionSource): ChatSessionRecord {
  const sessionRecord = typeof session.toObject === 'function'
    ? session.toObject()
    : session;

  const relatedNotes = Array.isArray(sessionRecord.relatedNotes)
    ? sessionRecord.relatedNotes
        .filter((rn) => rn.noteId !== null)
        .map((rn) => ({
          ...rn,
          createdAt: rn.matchType === 'care_source' && rn.createdAtSource !== 'note' ? undefined : rn.createdAt,
          noteId: typeof rn.noteId === 'object' && rn.noteId !== null && '_id' in rn.noteId
            ? String(rn.noteId._id)
            : String(rn.noteId),
        }))
    : undefined;

  return {
    ...(sessionRecord as Record<string, unknown>),
    ...(sessionRecord.sourceNoteId ? { sourceNoteId: String(sessionRecord.sourceNoteId) } : {}),
    relatedNotes,
  } as ChatSessionRecord;
}

class ChatService {
  private async getOwnedSession(userId: string, sessionId: string): Promise<IChat> {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) throw ErrorHandler.createValidationError('会话 ID 无效');
    const session = await Chat.findOne({ _id: sessionId, userId }).lean();
    if (!session) throw ErrorHandler.createNotFoundError('会话不存在或无权限');
    return session as unknown as IChat;
  }

  /** Resolve the persisted binding before any model call. Client history cannot rewrite sourced answers. */
  async prepareTurn(userId: string, messages: IMessage[], sessionId?: string, sourceNoteId?: string): Promise<PreparedChatTurn> {
    const session = sessionId ? await this.getOwnedSession(userId, sessionId) : undefined;
    const storedSourceId = session?.sourceNoteId ? String(session.sourceNoteId) : undefined;
    if (session && sourceNoteId && sourceNoteId !== storedSourceId) {
      throw ErrorHandler.createValidationError('会话绑定的笔记不能更换，请从这条笔记开启新对话');
    }
    const boundNoteId = storedSourceId || (!session ? sourceNoteId : undefined);
    if (!boundNoteId) return { messages: cleanMessages(messages) };

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== 'user' || !lastMessage.content?.trim()) {
      throw ErrorHandler.createValidationError('请发送一个问题以继续笔记对话');
    }
    const sourceSnapshot = await loadChatNoteSource(userId, boundNoteId);
    return {
      sourceNoteId: boundNoteId,
      sourceSnapshot,
      messages: session
        ? [...cleanMessages(session.messages, true), { role: 'user', content: lastMessage.content.trim() }]
        : cleanMessages(messages),
    };
  }

  /**
   * Save or update a chat session
   */
  async saveSession(
    userId: string,
    sessionId: string | undefined,
    messages: IMessage[],
    title?: string,
    relatedNotes?: unknown,
    options: SaveSessionOptions = {},
  ): Promise<IChat> {
    const cleanedMessages = cleanMessages(messages, options.trustedSourceSnapshots);
    if (!options.trustedSourceSnapshots) {
      const existing = sessionId ? await this.getOwnedSession(userId, sessionId) : undefined;
      if (existing) {
        const boundId = existing.sourceNoteId ? String(existing.sourceNoteId) : undefined;
        if (options.sourceNoteId && options.sourceNoteId !== boundId) {
          throw ErrorHandler.createValidationError('会话绑定的笔记不能更换');
        }
        if (boundId) {
          if (JSON.stringify(cleanMessages(existing.messages)) !== JSON.stringify(cleanedMessages)) {
            throw ErrorHandler.createValidationError('笔记对话请通过聊天继续，不能直接修改已有回答');
          }
          return existing;
        }
      } else if (options.sourceNoteId) {
        await loadChatNoteSource(userId, options.sourceNoteId);
      }
    }

    let chat;
    const cleanedRelatedNotes = normalizeRelatedNotes(relatedNotes);
    const updateData: Partial<IChat> = { messages: cleanedMessages, updatedAt: new Date() };
    if (title) updateData.title = title;
    if (cleanedRelatedNotes) updateData.relatedNotes = cleanedRelatedNotes;
    if (options.sourceNoteId) updateData.sourceNoteId = options.sourceNoteId;

    if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
      // Update existing session
      // Ensure ownership by including userId in query
      chat = await Chat.findOneAndUpdate(
        { _id: sessionId, userId },
        updateData,
        { new: true, runValidators: true }
      );
      
      if (!chat) {
        // If sessionId is valid but not found (or not owned by user), throw error
        // Or if it's just not found, maybe we should create a new one? 
        // The original logic in chatController.ts throws NotFound if not found.
        // The logic in routes/chat.ts creates a new one if not found or invalid.
        // Let's stick to the controller logic which seems more strict about ownership, 
        // but if the route logic was more lenient, we might want to check that.
        // Route logic: if (sessionId && isValid) update; if (!chat) throw NotFound.
        // So strict is better.
        throw ErrorHandler.createNotFoundError('会话不存在或无权限');
      }
    } else {
      // Create new session
      chat = new Chat({
        userId,
        messages: cleanedMessages,
        title: title || '新对话',
        sourceNoteId: options.sourceNoteId,
        relatedNotes: cleanedRelatedNotes || []
      });
      await chat.save();
    }

    return chat as unknown as IChat;
  }

  /**
   * Get all chat sessions for a user
   */
  async getSessions(userId: string): Promise<ChatSessionRecord[]> {
    const sessions = await Chat.find({ userId })
      .sort({ updatedAt: -1 })
      .populate({
        path: 'relatedNotes.noteId',
        select: '_id'
      })
      .lean();

    return (sessions as unknown as ChatSessionRecord[]).map((session) => normalizeSessionRecord(session));
  }

  /**
   * Delete a chat session
   */
  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const result = await Chat.findOneAndDelete({ _id: sessionId, userId });
    if (!result) {
      throw ErrorHandler.createNotFoundError('会话不存在或无权限删除');
    }
  }

  /**
   * Stream chat response from DeepSeek
   */
  async streamChat(messages: IMessage[], userId?: string, sourceSnapshot?: ChatSourceSnapshot): Promise<AsyncIterable<string>> {
    // Sanitize messages
    const cleanedMessages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({ role: m.role, content: m.content.trim() }));
      
    if (cleanedMessages.length === 0) {
       throw ErrorHandler.createValidationError('有效消息为空');
    }

    return chatWithDeepSeekStream(buildChatModelMessages(cleanedMessages, sourceSnapshot), AiUsageService.newContext('chat', userId));
  }

  /**
   * Generate a title summary for a chat
   */
  async summarizeTitle(userContent: string, aiContent: string, userId?: string): Promise<string> {
    const userText = (userContent ?? '').toString().trim();
    const aiText = (aiContent ?? '').toString().trim();

    if (!userText && !aiText) {
      return '未命名对话';
    }

    const prompt = userText && aiText ? `用户: ${userText}\nAI: ${aiText}` : (userText || aiText);
    return await summarizeChatTitle(prompt, userId);
  }

  /**
   * Generate an intro message from a random note
   */
  async generateIntro(userId: string): Promise<any> {
    const notes = await Note.find({ userId }).sort({ createdAt: -1 });

    if (!notes || notes.length === 0) {
      return {
        noteId: null,
        noteTitle: '',
        snippet: '',
        aiOpening: '我还没有看到你的任何笔记，要不要先去记录一点近期的想法或身体状况呢？'
      };
    }

    const randomNote = notes[Math.floor(Math.random() * notes.length)];
    const content = randomNote.content || '';
    const source = sourceMetadata(randomNote);
    const reference = {
      noteId: randomNote._id.toString(),
      noteTitle: typeof randomNote.title === 'string' ? randomNote.title : '',
      excerpt: source.excerpt,
      sourceType: source.sourceType,
      imageCount: source.imageCount,
      firstImageSrc: source.firstImageSrc,
      createdAt: source.createdAt,
      createdAtSource: 'note' as const,
    };
    
    // Split content logic
    const splitContentIntoNodes = (content: string): string[] => {
      if (!content) return [];
      const roughParts = content
        .split(/\n+/)
        .flatMap(line => line.split(/[。！？!\?；;：:]/g))
        .map(s => s.trim())
        .filter(Boolean);
      return roughParts.filter(s => s.length >= 4 && s.length <= 200);
    };

    const nodes = splitContentIntoNodes(content);
    
    if (!nodes || nodes.length === 0) {
      const fallbackSnippet = content.slice(0, 60);
      const prompt = `你将看到用户过往笔记中的一个片段，请用体贴、自然的语气发起一句关怀性中文开场白，最多60字，不要复述片段。片段:"${fallbackSnippet}"`;
      try {
        const aiOpening = await chatWithDeepSeek([
          { role: 'system', content: '你是一个富有洞察力且善于启发的思想伙伴。你的目标是通过回顾用户过去的笔记片段，提出一个有深度、能引发思考或激发表达欲的问题。尝试寻找片段背后的情绪、动机或潜在关联，而不仅仅是表面问候。' },
          { role: 'user', content: prompt }
        ], AiUsageService.newContext('care_intro', userId));
        return {
          ...reference,
          snippet: fallbackSnippet,
          aiOpening
        };
      } catch (_e) {
        return {
          ...reference,
          snippet: fallbackSnippet,
          aiOpening: '最近还好吗？我注意到你曾记录了一些重要事项，想关心一下你的近况。'
        };
      }
    }

    const snippet = nodes[Math.floor(Math.random() * nodes.length)];
    const system = '你是一个富有洞察力且善于启发的思想伙伴。你的目标是通过回顾用户过去的笔记片段，提出一个有深度、能引发思考或激发表达欲的问题。尝试寻找片段背后的情绪、动机或潜在关联，而不仅仅是表面问候。语气保持真诚、好奇且自然。最多60字。';
    const userMsg = `用户过往笔记片段:"${snippet}"。请基于此片段，构思一个能引发用户深层思考或分享欲望的简短开场白。可以是关于当时的感受、后续的思考，或者是对某个观点的进一步探讨。避免简单的寒暄。`;

    try {
      const aiOpening = await chatWithDeepSeek([
        { role: 'system', content: system },
        { role: 'user', content: userMsg }
      ], AiUsageService.newContext('care_intro', userId));
      return {
        ...reference,
        snippet,
        aiOpening
      };
    } catch (_e) {
      let aiOpening = '最近过得还好吗？看到你之前的记录，我想来问候一下。';
      if (/膝盖|膝关节/.test(snippet)) {
        aiOpening = '您的膝盖恢复情况如何？有没有感觉好一些？';
      }
      return {
        ...reference,
        snippet,
        aiOpening
      };
    }
  }

  formatSession(session: IChat | ChatSessionRecord): ChatSessionRecord {
    return normalizeSessionRecord(session as ChatSessionSource);
  }

}

export const chatService = new ChatService();

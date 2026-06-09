import Chat from '../models/Chat';
import { Note } from '../models/Note';
import { IChat, IMessage, IRelatedNote } from '../types';
import { ErrorHandler } from '../utils/errorHandler';
import { chatWithDeepSeekStream, summarizeChatTitle, chatWithDeepSeek } from './llmService';
import mongoose from 'mongoose';

type RelatedNoteRecord = Omit<IRelatedNote, 'noteId'> & {
  noteId: string | { _id?: string | null } | null;
};

type ChatSessionRecord = {
  _id: { toString(): string } | string;
  relatedNotes?: RelatedNoteRecord[];
  [key: string]: unknown;
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
      const score = typeof noteRecord.score === 'number'
        ? noteRecord.score
        : (typeof noteRecord.similarity === 'number' ? noteRecord.similarity : undefined);

      return {
        noteId: new mongoose.Types.ObjectId(noteId),
        title: typeof noteRecord.title === 'string' ? noteRecord.title : undefined,
        content: typeof noteRecord.content === 'string' ? noteRecord.content : undefined,
        score,
        matchType: typeof noteRecord.matchType === 'string' ? noteRecord.matchType : undefined,
        reason: typeof noteRecord.reason === 'string' ? noteRecord.reason : undefined,
        createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
      } as IRelatedNote;
    })
    .filter((note): note is IRelatedNote => note !== null);
}

class ChatService {
  /**
   * Save or update a chat session
   */
  async saveSession(
    userId: string,
    sessionId: string | undefined,
    messages: IMessage[],
    title?: string,
    relatedNotes?: IRelatedNote[]
  ): Promise<IChat> {
    // Sanitize messages
    const cleanedMessages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({ role: m.role, content: m.content.trim() }));

    let chat;
    const cleanedRelatedNotes = normalizeRelatedNotes(relatedNotes);
    const updateData: Partial<IChat> = { messages: cleanedMessages, updatedAt: new Date() };
    if (title) updateData.title = title;
    if (cleanedRelatedNotes) updateData.relatedNotes = cleanedRelatedNotes;

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

    return (sessions as ChatSessionRecord[]).map((session) => {
      const relatedNotes = Array.isArray(session.relatedNotes)
        ? session.relatedNotes
            .filter((rn) => rn.noteId !== null)
            .map((rn) => ({
          ...rn,
          noteId: typeof rn.noteId === 'object' && rn.noteId !== null && '_id' in rn.noteId
            ? String(rn.noteId._id)
            : String(rn.noteId),
            }))
        : undefined;

      return {
        ...(session as Record<string, unknown>),
        relatedNotes,
      } as ChatSessionRecord;
    });
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
  async streamChat(messages: IMessage[]): Promise<AsyncIterable<string>> {
    // Sanitize messages
    const cleanedMessages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({ role: m.role, content: m.content.trim() }));
      
    if (cleanedMessages.length === 0) {
       throw ErrorHandler.createValidationError('有效消息为空');
    }

    return chatWithDeepSeekStream(cleanedMessages);
  }

  /**
   * Generate a title summary for a chat
   */
  async summarizeTitle(userContent: string, aiContent: string): Promise<string> {
    const userText = (userContent ?? '').toString().trim();
    const aiText = (aiContent ?? '').toString().trim();

    if (!userText && !aiText) {
      return '未命名对话';
    }

    const prompt = userText && aiText ? `用户: ${userText}\nAI: ${aiText}` : (userText || aiText);
    return await summarizeChatTitle(prompt);
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
        ]);
        return {
          noteId: randomNote._id.toString(),
          noteTitle: randomNote.title,
          snippet: fallbackSnippet,
          aiOpening
        };
      } catch (_e) {
        return {
          noteId: randomNote._id.toString(),
          noteTitle: randomNote.title,
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
      ]);
      return {
        noteId: randomNote._id.toString(),
        noteTitle: randomNote.title,
        snippet,
        aiOpening
      };
    } catch (_e) {
      let aiOpening = '最近过得还好吗？看到你之前的记录，我想来问候一下。';
      if (/膝盖|膝关节/.test(snippet)) {
        aiOpening = '您的膝盖恢复情况如何？有没有感觉好一些？';
      }
      return {
        noteId: randomNote._id.toString(),
        noteTitle: randomNote.title,
        snippet,
        aiOpening
      };
    }
  }

}

export const chatService = new ChatService();

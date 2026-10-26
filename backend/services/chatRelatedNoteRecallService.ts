import { EMBEDDING_CONFIG } from '../config/embedding';
import { getCachedEmbedding } from '../utils/embedding';
import { vectorStore } from './vectorStore';
import { AiUsageService } from './aiUsageService';
import { sourceMetadata } from './noteSourceMetadata';

type RecallMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type VectorNoteRecord = {
  _id?: { toString(): string } | string;
  title?: string;
  content?: string;
  contentText?: string;
  contentJson?: unknown;
  createdAt?: Date | string;
};

export type RelatedNoteDto = {
  noteId: string;
  title?: string;
  content?: string;
  score?: number;
  matchType?: string;
  createdAt?: Date | string;
  excerpt?: string;
  sourceType?: 'text' | 'image' | 'mixed';
  imageCount?: number;
  firstImageSrc?: string;
};

type RecallFromMessagesInput = {
  userId: string;
  messages: RecallMessage[];
  limit?: number;
  threshold?: number;
  excludeNoteId?: string;
};

class ChatRelatedNoteRecallService {
  private readonly defaultLimit = 5;
  private readonly defaultThreshold = 0.3;
  private readonly maxContextMessages = 6;
  private readonly queryInputType = EMBEDDING_CONFIG.DEFAULTS.INPUT_TYPES.QUERY;

  private normalizeMessages(messages: RecallMessage[]): RecallMessage[] {
    return messages.filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0
    );
  }

  private buildContext(messages: RecallMessage[]): string {
    return messages
      .slice(-this.maxContextMessages)
      .map((message) => `${message.role === 'user' ? '用户' : 'AI'}: ${message.content.trim()}`)
      .join('\n');
  }

  private toRelatedNoteDto(note: VectorNoteRecord, score: number): RelatedNoteDto | null {
    const noteId = String(note?._id || '');
    if (!noteId) return null;

    const metadata = sourceMetadata(note);

    return {
      noteId,
      title: note.title,
      content: note.content,
      excerpt: metadata.excerpt,
      sourceType: metadata.sourceType,
      imageCount: metadata.imageCount,
      firstImageSrc: metadata.firstImageSrc,
      score,
      matchType: 'vector',
      createdAt: metadata.createdAt,
    };
  }

  async recallFromMessages({
    userId,
    messages,
    limit = this.defaultLimit,
    threshold = this.defaultThreshold,
    excludeNoteId,
  }: RecallFromMessagesInput): Promise<RelatedNoteDto[]> {
    const normalizedMessages = this.normalizeMessages(messages);
    const context = this.buildContext(normalizedMessages);

    if (!context) {
      return [];
    }

    const queryEmbedding = await getCachedEmbedding(context, {
      inputType: this.queryInputType,
    }, AiUsageService.newContext('embedding', userId));
    const searchLimit = Math.max(limit, 1) * 2;
    const rawResults = await vectorStore.search(userId, queryEmbedding, searchLimit);

    return rawResults
      .filter((item) => item.score >= threshold)
      .map((item) => this.toRelatedNoteDto(item.item as VectorNoteRecord, item.score))
      .filter((item): item is RelatedNoteDto => item !== null)
      .filter((item) => !excludeNoteId || item.noteId !== excludeNoteId)
      .slice(0, limit);
  }
}

export const chatRelatedNoteRecallService = new ChatRelatedNoteRecallService();

import { Note } from '../models/Note';
import NoteAiPreference from '../models/NoteAiPreference';
import { chatWithDeepSeek } from './llmService';
import { ErrorHandler } from '../utils/errorHandler';
import { decodeNoteCursor, encodeNoteCursor } from './noteListCursor';
import { noteEmbeddingService } from './noteEmbeddingService';
import {
  getEnrichmentView,
  noteWriteModule,
  NoteWriteError,
  toNoteDto,
  type CreateNoteInput,
  type NoteDto,
  type NoteWriteResult,
  type UpdateNoteInput,
} from './NoteUpdateOrchestrator';
import { runProductionNoteEnrichmentTask } from './noteEnrichmentWorker';

export type NoteListItem = NoteDto & {
  enrichment: ReturnType<typeof getEnrichmentView>;
  aiIncluded: boolean;
};

export type NotePage = {
  notes: NoteListItem[];
  pageInfo: {
    hasNextPage: boolean;
    nextCursor: string | null;
  };
};

type NotePageOptions = {
  limit?: number;
  cursor?: string;
};

const DEFAULT_NOTE_PAGE_LIMIT = 30;
const MAX_NOTE_PAGE_LIMIT = 50;

function normalizePageLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_NOTE_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw ErrorHandler.createValidationError('笔记分页大小无效', { code: 'NOTE_PAGE_LIMIT_INVALID' });
  }
  return Math.min(limit, MAX_NOTE_PAGE_LIMIT);
}

function toListItem(value: unknown, aiIncluded: boolean): NoteListItem {
  const record = typeof value === 'object' && value !== null && 'toObject' in value && typeof value.toObject === 'function'
    ? value.toObject()
    : value;
  return {
    ...toNoteDto(record as Parameters<typeof toNoteDto>[0]),
    enrichment: getEnrichmentView(record as Parameters<typeof getEnrichmentView>[0]),
    aiIncluded,
  };
}

function toLlmRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'assistant' || role === 'system') return role;
  return 'user';
}

class NoteService {
  async getNotesPage(userId: string, options: NotePageOptions): Promise<NotePage> {
    const limit = normalizePageLimit(options.limit);
    const decodedCursor = options.cursor === undefined ? null : decodeNoteCursor(options.cursor);
    const filter = decodedCursor
      ? {
        userId,
        $or: [
          { createdAt: { $lt: decodedCursor.createdAt } },
          { createdAt: decodedCursor.createdAt, _id: { $lt: decodedCursor.id } },
        ],
      }
      : { userId };
    const records = await Note.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasNextPage = records.length > limit;
    const pageRecords = hasNextPage ? records.slice(0, limit) : records;
    const noteIds = pageRecords.map((note) => String(note._id));
    const preferences = noteIds.length === 0
      ? []
      : await NoteAiPreference.find({ userId, noteId: { $in: noteIds } }).lean();
    const includedByNoteId = new Map(preferences.map((preference) => [String(preference.noteId), preference.included !== false]));
    const notes = pageRecords.map((note) => toListItem(note, includedByNoteId.get(String(note._id)) ?? true));
    const lastNote = pageRecords[pageRecords.length - 1];

    return {
      notes,
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && lastNote
          ? encodeNoteCursor({ createdAt: new Date(lastNote.createdAt), id: String(lastNote._id) })
          : null,
      },
    };
  }

  async getNote(userId: string, noteId: string): Promise<NoteListItem> {
    const note = await Note.findOne({ _id: noteId, userId }).lean();
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    const preference = await NoteAiPreference.findOne({ userId, noteId }).lean();
    const included = (preference as { included?: boolean } | null)?.included !== false;
    return toListItem(note, included);
  }

  async getNotes(userId: string): Promise<NoteListItem[]> {
    return (await this.getNotesPage(userId, { limit: MAX_NOTE_PAGE_LIMIT })).notes;
  }

  async createNote(userId: string, data: Pick<CreateNoteInput, 'body'>): Promise<NoteWriteResult> {
    return noteWriteModule.create({ userId, body: data.body });
  }

  async deleteNote(userId: string, noteId: string): Promise<void> {
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    await Note.deleteOne({ _id: noteId });
  }

  async generateEmbedding(userId: string, noteId: string): Promise<{ embedding?: number[]; skipped?: boolean }> {
    const note = await Note.findOne({ _id: noteId, userId }).select('_id');
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    return noteEmbeddingService.generateEmbeddingForNote(userId, noteId);
  }

  async simpleChat(_userId: string, messages: { role: string; content: string }[]): Promise<string> {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw ErrorHandler.createValidationError('消息内容无效');
    }
    const safeMessages = messages.map((message) => ({
      role: toLlmRole(message.role),
      content: String(message.content || ''),
    }));
    return chatWithDeepSeek(safeMessages);
  }

  async updateTitle(userId: string, noteId: string, title: string): Promise<NoteWriteResult> {
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) throw new NoteWriteError('NOTE_NOT_FOUND', '笔记不存在或无权限', 404);
    return noteWriteModule.update({
      userId,
      noteId,
      expectedRevision: typeof note.revision === 'number' && note.revision > 0 ? note.revision : 1,
      changes: { title },
    });
  }

  async getEmbeddingStats(userId: string): Promise<unknown> {
    return noteEmbeddingService.getUserEmbeddingStats(userId);
  }

  async ensureEmbeddings(userId: string, limitNum: number = 20): Promise<{ processed: number; success: number }> {
    return noteEmbeddingService.ensureUserEmbeddings(userId, limitNum);
  }

  async ensureSummaries(userId: string, limitNum: number = 20): Promise<{ processed: number; success: number }> {
    const limit = Math.max(1, Math.min(50, limitNum));
    const pending = await Note.find({
      userId,
      $or: [
        { summary: { $exists: false } },
        { summary: null },
        { summary: '' },
        { concepts: { $exists: false } },
        { 'enrichment.meta.status': { $in: ['missing', 'pending', 'failed'] } },
        { enrichment: { $exists: false } },
        { $expr: { $ne: ['$enrichment.meta.sourceRevision', '$revision'] } },
      ],
    }).select('_id content contentText revision').limit(limit);
    let success = 0;
    for (const note of pending) {
      const baseText = String(note.contentText || note.content || '').trim();
      if (!baseText) continue;
      const status = await runProductionNoteEnrichmentTask({
        noteId: note._id.toString(),
        userId,
        sourceRevision: typeof note.revision === 'number' && note.revision > 0 ? note.revision : 1,
        artifact: 'meta',
      });
      if (status === 'saved') success++;
    }
    return { processed: pending.length, success };
  }

  async regenerateSummary(userId: string, noteId: string): Promise<string> {
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    const baseText = String(note.contentText || note.content || '').trim();
    if (!baseText) throw ErrorHandler.createValidationError('内容不能为空');
    const revision = typeof note.revision === 'number' && note.revision > 0 ? note.revision : 1;
    await runProductionNoteEnrichmentTask({ noteId, userId, sourceRevision: revision, artifact: 'meta' });
    const refreshed = await Note.findOne({ _id: noteId, userId, revision }).select('summary');
    return String(refreshed?.summary || '');
  }

  async updateNote(
    userId: string,
    noteId: string,
    data: Pick<UpdateNoteInput, 'expectedRevision' | 'changes'>,
  ): Promise<NoteWriteResult> {
    return noteWriteModule.update({ userId, noteId, ...data });
  }
}

export const noteService = new NoteService();

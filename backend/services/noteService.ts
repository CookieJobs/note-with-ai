import { Note } from '../models/Note';
import { chatWithDeepSeek } from './llmService';
import { ErrorHandler } from '../utils/errorHandler';
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

type NoteListItem = NoteDto & { enrichment: ReturnType<typeof getEnrichmentView> };

function toLlmRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'assistant' || role === 'system') return role;
  return 'user';
}

class NoteService {
  async getNotes(userId: string): Promise<NoteListItem[]> {
    const notes = await Note.find({ userId }).sort({ createdAt: -1 });
    return notes.map((note) => {
      const value = typeof note.toObject === 'function' ? note.toObject() : note;
      return {
        ...toNoteDto(value),
        enrichment: getEnrichmentView(value),
      };
    });
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

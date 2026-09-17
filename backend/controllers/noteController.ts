import { Request, Response, NextFunction } from 'express';
import { noteService } from '../services/noteService';
import { ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { requireSingleRouteParam } from '../utils/requestParams';
import {
  getEnrichmentView,
  NoteWriteError,
  toNoteDto,
  type NoteBodyInput,
  type UpdateNoteInput,
} from '../services/NoteUpdateOrchestrator';
import { AppError, ErrorType } from '../utils/errorHandler';
import { Note } from '../models/Note';

type LegacyCreateBody = {
  body?: NoteBodyInput;
  content?: unknown;
  contentJson?: unknown;
  contentText?: unknown;
};

type LegacyUpdateBody = LegacyCreateBody & {
  expectedRevision?: unknown;
  changes?: UpdateNoteInput['changes'];
  title?: unknown;
  keywords?: unknown;
  updatedAt?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function bodyFromLegacyRequest(data: LegacyCreateBody): NoteBodyInput {
  if (data.body) return data.body;
  const document = record(data.contentJson);
  if (document) {
    return {
      kind: 'rich-text',
      document,
      ...(typeof data.content === 'string' ? { fallbackMarkdown: data.content } : {}),
    };
  }
  return {
    kind: 'plain-text',
    text: typeof data.contentText === 'string'
      ? data.contentText
      : typeof data.content === 'string'
        ? data.content
        : '',
  };
}

function changesFromLegacyRequest(data: LegacyUpdateBody): UpdateNoteInput['changes'] {
  if (data.changes) return data.changes;
  const changes: UpdateNoteInput['changes'] = {};
  const document = record(data.contentJson);
  if (document) {
    changes.body = {
      kind: 'rich-text',
      document,
      ...(typeof data.content === 'string' ? { fallbackMarkdown: data.content } : {}),
    };
  } else if (typeof data.contentText === 'string' || typeof data.content === 'string') {
    changes.body = {
      kind: 'plain-text',
      text: typeof data.contentText === 'string' ? data.contentText : data.content as string,
    };
  }
  if (typeof data.title === 'string') changes.title = data.title;
  if (Array.isArray(data.keywords) && data.keywords.every((keyword) => typeof keyword === 'string')) {
    changes.keywords = data.keywords;
  }
  return changes;
}

async function updateInputFromHttp(
  userId: string,
  noteId: string,
  data: LegacyUpdateBody,
): Promise<Pick<UpdateNoteInput, 'expectedRevision' | 'changes'>> {
  if (typeof data.expectedRevision === 'number' && data.changes) {
    return { expectedRevision: data.expectedRevision, changes: data.changes };
  }

  // Old payloads remain supported here only; the write service itself receives revision-only input.
  const note = await Note.findOne({ _id: noteId, userId });
  if (!note) throw new NoteWriteError('NOTE_NOT_FOUND', '笔记不存在或无权限', 404);
  if (data.updatedAt !== undefined) {
    const clientUpdatedAt = new Date(String(data.updatedAt)).getTime();
    const serverUpdatedAt = note.updatedAt instanceof Date ? note.updatedAt.getTime() : Number.NaN;
    if (Number.isNaN(clientUpdatedAt) || Number.isNaN(serverUpdatedAt)) {
      throw new NoteWriteError('NOTE_BODY_INVALID', 'updatedAt 无效', 400);
    }
    if (clientUpdatedAt !== serverUpdatedAt) {
      const value = typeof note.toObject === 'function' ? note.toObject() : note;
      throw new NoteWriteError('NOTE_WRITE_CONFLICT', '笔记已被其他写入更新', 409, {
        note: toNoteDto(value),
        enrichment: getEnrichmentView(value),
      });
    }
  }
  return {
    expectedRevision: typeof note.revision === 'number' && note.revision > 0 ? note.revision : 1,
    changes: changesFromLegacyRequest(data),
  };
}

function mapNoteWriteError(error: unknown): never {
  if (error instanceof NoteWriteError) {
    const type = error.statusCode === 404
      ? ErrorType.NOT_FOUND
      : error.statusCode === 500
        ? ErrorType.INTERNAL
        : ErrorType.VALIDATION;
    throw new AppError(error.message, type, error.statusCode, true, {
      code: error.code,
      ...(error.current ? { current: error.current } : {}),
    });
  }
  throw error;
}

class NoteController {
  // GET /
  async getNotes(req: Request, res: Response, next: NextFunction) {
    const user = await UserValidator.authenticateUser(req);
    const notes = await noteService.getNotes(user._id.toString());
    ResponseHandler.success(res, { notes }, '获取笔记成功');
  }

  // POST /
  async createNote(req: Request, res: Response, next: NextFunction) {
    const user = await UserValidator.authenticateUser(req);
    try {
      const result = await noteService.createNote(user._id.toString(), { body: bodyFromLegacyRequest(req.body) });
      ResponseHandler.success(res, result, '笔记创建成功', 201);
    } catch (error) {
      mapNoteWriteError(error);
    }
  }

  // DELETE /:id
  async deleteNote(req: Request, res: Response, next: NextFunction) {
    const id = requireSingleRouteParam(req.params.id, 'id');
    const user = await UserValidator.authenticateUser(req);
    await noteService.deleteNote(user._id.toString(), id);
    ResponseHandler.success(res, null, '笔记删除成功');
  }

  // POST /:id/embed
  async generateEmbedding(req: Request, res: Response, next: NextFunction) {
    const id = requireSingleRouteParam(req.params.id, 'id');
    const user = await UserValidator.authenticateUser(req);
    const result = await noteService.generateEmbedding(user._id.toString(), id);
    if (result.skipped) {
        ResponseHandler.success(res, { skipped: true }, '笔记已更新，跳过写入旧 embedding');
    } else {
        ResponseHandler.success(res, { embedding: result.embedding }, 'embedding 生成成功');
    }
  }

  // POST /chat
  async chat(req: Request, res: Response, next: NextFunction) {
    const { messages } = req.body;
    const user = await UserValidator.authenticateUser(req);
    const reply = await noteService.simpleChat(user._id.toString(), messages);
    ResponseHandler.success(res, { reply }, '聊天成功');
  }

  // POST /:id (update title)
  async updateTitle(req: Request, res: Response, next: NextFunction) {
    const id = requireSingleRouteParam(req.params.id, 'id');
    const { title } = req.body;
    const user = await UserValidator.authenticateUser(req);
    try {
      const result = await noteService.updateTitle(user._id.toString(), id, title);
      ResponseHandler.success(res, result, '笔记标题更新成功');
    } catch (error) {
      mapNoteWriteError(error);
    }
  }

  // GET /embedding/stats
  async getEmbeddingStats(req: Request, res: Response, next: NextFunction) {
    const user = await UserValidator.authenticateUser(req);
    const stats = await noteService.getEmbeddingStats(user._id.toString());
    ResponseHandler.success(res, stats);
  }

  // POST /embedding/ensure
  async ensureEmbeddings(req: Request, res: Response, next: NextFunction) {
    const user = await UserValidator.authenticateUser(req);
    const limit = Number(req.body?.limit ?? 20);
    const result = await noteService.ensureEmbeddings(user._id.toString(), limit);
    if (result.processed === 0) {
        ResponseHandler.success(res, result, '没有需要补齐 embedding 的笔记');
    } else {
        ResponseHandler.success(res, result, 'embedding 补齐完成');
    }
  }

  // POST /summary/ensure
  async ensureSummaries(req: Request, res: Response, next: NextFunction) {
    const user = await UserValidator.authenticateUser(req);
    const limit = Number(req.body?.limit ?? 20);
    const result = await noteService.ensureSummaries(user._id.toString(), limit);
    if (result.processed === 0) {
        ResponseHandler.success(res, result, '没有需要补齐 summary 的笔记');
    } else {
        ResponseHandler.success(res, result, 'summary 补齐完成');
    }
  }

  // POST /:id/summary
  async regenerateSummary(req: Request, res: Response, next: NextFunction) {
    const id = requireSingleRouteParam(req.params.id, 'id');
    const user = await UserValidator.authenticateUser(req);
    const summary = await noteService.regenerateSummary(user._id.toString(), id);
    ResponseHandler.success(res, { summary }, 'summary 生成成功');
  }

  // PATCH /:id
  async updateNote(req: Request, res: Response, next: NextFunction) {
    const id = requireSingleRouteParam(req.params.id, 'id');
    const user = await UserValidator.authenticateUser(req);
    
    try {
      const input = await updateInputFromHttp(user._id.toString(), id, req.body);
      const result = await noteService.updateNote(user._id.toString(), id, input);
      ResponseHandler.success(res, result, '笔记更新成功');
    } catch (error) {
      mapNoteWriteError(error);
    }
  }
}

export const noteController = new NoteController();

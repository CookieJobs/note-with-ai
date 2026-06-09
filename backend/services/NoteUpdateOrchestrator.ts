import { Note } from '../models/Note';
import { INote } from '../types';
import { logger } from '../utils/logger';
import { summarizeNoteMeta, checkOrUpdateSummaryConcepts } from './llmService';
import { noteEmbeddingService } from './noteEmbeddingService';
import { ErrorHandler, AppError, ErrorType } from '../utils/errorHandler';

export class NoteContentPatch {
  constructor(
    public title?: string,
    public content?: string,
    public contentText?: string,
    public contentJson?: Record<string, unknown>,
    public keywords?: string[]
  ) {}

  static fromRequest(data: Partial<INote>) {
    return new NoteContentPatch(
      data.title,
      data.content,
      data.contentText,
      data.contentJson,
      data.keywords
    );
  }

  apply(note: any): { contentChanged: boolean } {
    let contentChanged = false;
    
    if (this.title !== undefined) note.title = this.title.trim();
    
    if (this.contentText !== undefined) {
      note.contentText = this.contentText;
      note.content = this.contentText;
      contentChanged = true;
    } else if (this.content !== undefined) {
      note.content = this.content;
      note.contentText = this.content;
      note.contentJson = null;
      contentChanged = true;
    }
    
    if (this.contentJson !== undefined) {
      note.contentJson = this.contentJson;
    }
    
    if (this.keywords !== undefined) {
      note.keywords = this.keywords;
    }

    if (contentChanged) {
      note.embedding = [];
      note.recommendCache = null;
    }

    return { contentChanged };
  }
}

export class NoteUpdateOrchestrator {
  static async execute(params: {
    userId: string;
    noteId: string;
    expectedUpdatedAt?: string | Date;
    patch: NoteContentPatch;
    options: {
      summaryCheck?: boolean;
      autoSummarize?: boolean;
    };
  }): Promise<INote> {
    const { userId, noteId, expectedUpdatedAt, patch, options } = params;

    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
      throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    }

    // 1. 并发校验
    if (expectedUpdatedAt) {
      const clientUpdatedAt = new Date(expectedUpdatedAt).getTime();
      const currentUpdatedAt = new Date(note.updatedAt).getTime();
      if (isNaN(clientUpdatedAt)) {
        throw ErrorHandler.createValidationError('updatedAt 无效');
      }
      if (clientUpdatedAt !== currentUpdatedAt) {
        throw new AppError('笔记已在他处更新', ErrorType.VALIDATION, 409, true, { note });
      }
    }

    // 2. 应用普通更新
    const { contentChanged } = patch.apply(note);

    // 3. 执行 AI 策略
    if (options.summaryCheck && contentChanged) {
      try {
        return await this.applySummaryCheck(noteId, userId, note, patch);
      } catch (e: any) {
        if (e.statusCode === 409) throw e;
        logger.warn('summaryCheck 失败，忽略：', e);
      }
    } else if (options.autoSummarize) {
      try {
        const freshNote = await this.applyAutoSummarize(noteId, userId, note, patch);
        if (freshNote) return freshNote;
      } catch (e) {
        logger.warn('自动摘要失败，忽略：', e);
      }
    }

    // 4. 兜底基础保存（当未开启 AI 策略或 AI 策略执行失败时）
    await note.save();
    logger.info('✅ 笔记局部更新成功');

    if (contentChanged) {
      this.scheduleEmbeddingUpdate(userId, note);
    }

    return note as unknown as INote;
  }

  private static async applySummaryCheck(noteId: string, userId: string, originalNote: any, patch: NoteContentPatch) {
    const oldSummary = String(originalNote.summary || '').trim();
    const oldConcepts = Array.isArray(originalNote.concepts) ? originalNote.concepts : [];
    const baseText = String(originalNote.contentText || originalNote.content || '').trim();
    
    const check = await checkOrUpdateSummaryConcepts({ text: baseText, oldSummary, oldConcepts });
    
    const freshNote = await Note.findById(noteId);
    if (!freshNote) throw ErrorHandler.createNotFoundError('笔记不存在');

    const freshUpdatedTime = new Date(freshNote.updatedAt).getTime();
    const originalUpdatedTime = new Date(originalNote.updatedAt).getTime();
    
    if (freshUpdatedTime !== originalUpdatedTime) {
      logger.warn(`summaryCheck 期间发生并发修改，放弃覆盖。ID: ${noteId}`);
      throw new AppError('笔记已在他处更新（AI处理期间）', ErrorType.VALIDATION, 409, true, { note: freshNote });
    }

    patch.apply(freshNote);

    if (check && check.is_ok === false) {
      if (typeof check.summary === 'string') freshNote.summary = check.summary;
      if (Array.isArray(check.concepts)) freshNote.concepts = check.concepts;
    }

    await freshNote.save();
    this.scheduleEmbeddingUpdate(userId, freshNote);
    return freshNote as unknown as INote;
  }

  private static async applyAutoSummarize(noteId: string, userId: string, originalNote: any, patch: NoteContentPatch) {
    const summary = await summarizeNoteMeta(originalNote.content);
    const freshNote = await Note.findById(noteId);
    if (!freshNote) throw ErrorHandler.createNotFoundError('笔记不存在');

    const freshUpdatedTime = new Date(freshNote.updatedAt).getTime();
    const originalUpdatedTime = new Date(originalNote.updatedAt).getTime();

    if (freshUpdatedTime !== originalUpdatedTime) {
      const isTitleDefault = !freshNote.title || 
                            freshNote.title === '未命名笔记' || 
                            freshNote.title === (freshNote.contentText || '').split('\n')[0].trim().slice(0, 100);
      const isKeywordsEmpty = !freshNote.keywords || freshNote.keywords.length === 0;

      if (!isTitleDefault && !isKeywordsEmpty) {
        logger.warn(`autoSummarize 期间发生实质性并发修改（用户已修改标题/关键词），放弃更新。ID: ${noteId}`);
        return freshNote as unknown as INote;
      }
      logger.info(`autoSummarize 期间发生并发修改，但标题/关键词仍为默认，尝试合并更新。ID: ${noteId}`);
    }

    const { contentChanged } = patch.apply(freshNote);

    const isTitleDefault = !freshNote.title || 
                          freshNote.title === '未命名笔记' || 
                          freshNote.title === (freshNote.contentText || '').split('\n')[0].trim().slice(0, 100);
    
    if (summary?.title && patch.title === undefined && isTitleDefault) {
      freshNote.title = summary.title;
    }
    if (Array.isArray(summary?.keywords) && patch.keywords === undefined && (!freshNote.keywords || freshNote.keywords.length === 0)) {
      freshNote.keywords = summary.keywords;
    }
    if (typeof summary?.summary === 'string') freshNote.summary = summary.summary;

    await freshNote.save();
    
    // Original autoSummarize block only scheduled embedding if we fell through, but here contentChanged handles it 
    // Wait, the original code had:
    // this.scheduleEmbeddingUpdate({ ... }) inside autoSummarize
    this.scheduleEmbeddingUpdate(userId, freshNote);
    
    return freshNote as unknown as INote;
  }

  private static scheduleEmbeddingUpdate(userId: string, note: any) {
    noteEmbeddingService.scheduleEmbeddingUpdate({
      noteId: note._id.toString(),
      userId: userId,
      updatedAt: note.updatedAt,
      title: note.title,
      content: note.content,
      contentText: note.contentText,
    });
  }
}

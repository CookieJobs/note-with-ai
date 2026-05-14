import { Note } from '../models/Note';
import { summarizeNoteMeta, summarizeNoteSummary, checkOrUpdateSummaryConcepts } from './llmService';
import { DeepSeekApiClient } from '../utils/apiClient';
import { ErrorHandler, AppError, ErrorType } from '../utils/errorHandler';
import { INote } from '../types';
import { logger } from '../utils/logger';
import { noteEmbeddingService } from './noteEmbeddingService';

class NoteService {
  private scheduleEmbeddingUpdate(params: {
    noteId: string;
    userId: string;
    updatedAt: Date;
    title?: string;
    content?: string;
    contentText?: string;
  }) {
    noteEmbeddingService.scheduleEmbeddingUpdate(params);
  }

  async getNotes(userId: string): Promise<INote[]> {
    const notes = await Note.find({ userId }).sort({ createdAt: -1 });

    // 兼容旧数据：历史记录可能没有 contentText（或为空字符串），前端富文本/展示需要一个可用的纯文本字段
    const safeNotes = notes.map((n: INote) => {
      const obj = typeof n.toObject === 'function' ? n.toObject() : n;
      if (typeof obj.contentText !== 'string' || obj.contentText.trim().length === 0) {
        obj.contentText = obj.content || '';
      }
      return obj;
    });

    return safeNotes;
  }

  async createNote(userId: string, data: { content?: string; contentJson?: Record<string, unknown>; contentText?: string }): Promise<INote> {
    const { content, contentJson, contentText } = data;
    const plain = (typeof contentText === 'string' ? contentText : (typeof content === 'string' ? content : '')).trim();
    if (!plain) {
      throw ErrorHandler.createValidationError('内容不能为空');
    }
    if (contentJson !== undefined && (typeof contentJson !== 'object' || contentJson === null)) {
      throw ErrorHandler.createValidationError('contentJson 必须是对象类型');
    }

    const firstLine = (plain || '').split('\n')[0].trim();
    const fallbackTitle = firstLine.length > 0 ? firstLine.slice(0, 100) : '';
    const note = new Note({
      // 兼容字段：content 仍保存纯文本（用于旧逻辑/兜底展示）
      content: plain,
      contentText: plain,
      contentJson: contentJson,
      title: fallbackTitle,
      summary: '',
      concepts: [],
      keywords: [],
      userId: userId,
    });
    const savedNote = await note.save();

    // 自动生成 embedding（异步，不阻塞创建）
    this.scheduleEmbeddingUpdate({
      noteId: savedNote._id.toString(),
      userId: userId,
      updatedAt: (savedNote as any).updatedAt,
      title: savedNote.title,
      content: savedNote.content,
      contentText: (savedNote as any).contentText,
    });

    return savedNote as unknown as INote;
  }

  async deleteNote(userId: string, noteId: string): Promise<void> {
    // 验证资源所有权 (Logic moved from ResourceValidator effectively, or keep using it in controller? 
    // Usually service does the check. But ResourceValidator takes Model. 
    // Let's do the check here manually or use ResourceValidator if imported.
    // To minimize dependencies and keeping it pure logic, I'll do findOneAndDelete with userId)
    
    // Original logic used ResourceValidator.validateOwnership then findByIdAndDelete.
    // I can just do findOneAndDelete({_id: noteId, userId}).
    // But validateOwnership throws specific 404/403.
    // Let's try to find it first.
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
        throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    }

    await Note.deleteOne({ _id: noteId });
  }

  async generateEmbedding(userId: string, noteId: string): Promise<{ embedding?: number[], skipped?: boolean }> {
    const note = await Note.findOne({ _id: noteId, userId }).select('_id');
    if (!note) {
      throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    }

    return noteEmbeddingService.generateEmbeddingForNote(userId, noteId);
  }

  async simpleChat(userId: string, messages: { role: string; content: string }[]): Promise<string> {
      // Logic from POST /chat
      if (!Array.isArray(messages) || messages.length === 0) {
        throw ErrorHandler.createValidationError('消息内容无效');
      }
    
      const apiClient = new DeepSeekApiClient(process.env.DEEPSEEK_API_KEY!);
      const reply = await apiClient.chatCompletion(messages, {
        temperature: 0.7,
        stream: false
      });
      return reply;
  }

  async updateTitle(userId: string, noteId: string, title: string): Promise<INote> {
      if (title === undefined || typeof title !== 'string') {
        throw ErrorHandler.createValidationError('标题必须是字符串类型');
      }

      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
          throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
      }

      note.title = title.trim();
      await note.save();
      logger.info('✅ 笔记标题更新成功');
      return note as unknown as INote;
  }

  async getEmbeddingStats(userId: string): Promise<any> {
    return noteEmbeddingService.getUserEmbeddingStats(userId);
  }

  async ensureEmbeddings(userId: string, limitNum: number = 20): Promise<{ processed: number; success: number }> {
    return noteEmbeddingService.ensureUserEmbeddings(userId, limitNum);
  }

  async ensureSummaries(userId: string, limitNum: number = 20): Promise<{ processed: number; success: number }> {
    const limit = Math.max(1, Math.min(50, limitNum));

    const pending = await Note.find({
      userId,
      $or: [{ summary: { $exists: false } }, { summary: null }, { summary: '' }],
    })
      .select('_id content contentText updatedAt')
      .limit(limit);

    if (pending.length === 0) {
      return { processed: 0, success: 0 };
    }

    let success = 0;
    for (let i = 0; i < pending.length; i++) {
      const note = pending[i] as any;
      const baseText = String(note.contentText || note.content || '').trim();
      if (!baseText) continue;
      const summary = await summarizeNoteSummary(baseText);
      if (!summary) continue;
      const r = await Note.updateOne(
        { _id: note._id, userId, updatedAt: note.updatedAt },
        { $set: { summary } }
      );
      if (r && (r as any).matchedCount > 0) success++;
    }

    return { processed: pending.length, success };
  }

  async regenerateSummary(userId: string, noteId: string): Promise<string> {
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
        throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    }
    
    const baseText = String((note as any).contentText || (note as any).content || '').trim();
    if (!baseText) throw ErrorHandler.createValidationError('内容不能为空');
    const summary = await summarizeNoteSummary(baseText);
    await Note.updateOne({ _id: noteId, userId }, { $set: { summary } });
    return summary;
  }

  async updateNote(userId: string, noteId: string, data: Partial<INote> & { autoSummarize?: boolean; summaryCheck?: boolean }): Promise<INote> {
    const { title, content, contentJson, contentText, keywords, updatedAt, autoSummarize, summaryCheck } = data;
    logger.info('收到笔记局部更新请求，ID:', noteId, 'payload:', { title, content, contentText, keywords, updatedAt, autoSummarize, summaryCheck });

    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
        throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    }

    // 乐观并发
    if (updatedAt) {
      const clientUpdatedAt = new Date(updatedAt).getTime();
      const currentUpdatedAt = new Date(note.updatedAt).getTime();
      if (isNaN(clientUpdatedAt)) {
        throw ErrorHandler.createValidationError('updatedAt 无效');
      }
      if (clientUpdatedAt !== currentUpdatedAt) {
        // Return conflict error
        throw new AppError('笔记已在他处更新', ErrorType.VALIDATION, 409, true, { note });
      }
    }

    // 字段校验
    if (title !== undefined && typeof title !== 'string') throw ErrorHandler.createValidationError('标题必须是字符串类型');
    if (content !== undefined && typeof content !== 'string') throw ErrorHandler.createValidationError('内容必须是字符串类型');
    if (contentText !== undefined && typeof contentText !== 'string') throw ErrorHandler.createValidationError('contentText 必须是字符串类型');
    if (contentJson !== undefined && typeof contentJson !== 'object') throw ErrorHandler.createValidationError('contentJson 必须是 JSON 对象');
    if (keywords !== undefined && (!Array.isArray(keywords) || !keywords.every((k: unknown) => typeof k === 'string'))) {
        throw ErrorHandler.createValidationError('关键词必须是字符串数组');
    }
    if (summaryCheck !== undefined && typeof summaryCheck !== 'boolean') throw ErrorHandler.createValidationError('summaryCheck 必须是 boolean');

    // 应用更新
    let contentChanged = false;
    if (title !== undefined) note.title = title.trim();
    if (contentText !== undefined) {
      note.contentText = contentText;
      note.content = contentText;
      contentChanged = true;
    } else if (content !== undefined) {
      note.content = content;
      note.contentText = content;
      note.contentJson = null;
      contentChanged = true;
    }
    if (contentJson !== undefined) {
      note.contentJson = contentJson;
    }
    if (keywords !== undefined) note.keywords = keywords;

    if (contentChanged) {
      (note as any).embedding = [];
      (note as any).recommendCache = null;
    }

    // summaryCheck logic
    if (summaryCheck === true && contentChanged) {
      try {
        const oldSummary = String((note as any).summary || '').trim();
        const oldConcepts = Array.isArray((note as any).concepts) ? (note as any).concepts : [];
        const baseText = String(note.contentText || note.content || '').trim();
        const check = await checkOrUpdateSummaryConcepts({ text: baseText, oldSummary, oldConcepts });

        const freshNote = await Note.findById(noteId);
        
        if (freshNote) {
          const freshUpdatedTime = new Date(freshNote.updatedAt).getTime();
          const originalUpdatedTime = new Date(note.updatedAt).getTime();
          
          if (freshUpdatedTime !== originalUpdatedTime) {
              logger.warn(`summaryCheck 期间发生并发修改，放弃覆盖。ID: ${noteId}`);
              throw new AppError('笔记已在他处更新（AI处理期间）', ErrorType.VALIDATION, 409, true, { note: freshNote });
          }

          if (title !== undefined) freshNote.title = title.trim();
          if (contentText !== undefined) {
            freshNote.contentText = contentText;
            freshNote.content = contentText;
          } else if (content !== undefined) {
            freshNote.content = content;
            freshNote.contentText = content;
            freshNote.contentJson = null;
          }
          if (contentJson !== undefined) {
            freshNote.contentJson = contentJson;
          }
          if (keywords !== undefined) freshNote.keywords = keywords;

          (freshNote as any).embedding = [];
          (freshNote as any).recommendCache = null;

          if (check && check.is_ok === false) {
            if (typeof check.summary === 'string') (freshNote as any).summary = check.summary;
            if (Array.isArray(check.concepts)) (freshNote as any).concepts = check.concepts;
          }

          await freshNote.save();

          this.scheduleEmbeddingUpdate({
            noteId: freshNote._id.toString(),
            userId: userId,
            updatedAt: (freshNote as any).updatedAt,
            title: freshNote.title,
            content: freshNote.content,
            contentText: (freshNote as any).contentText,
          });

          return freshNote as unknown as INote;
        }
      } catch (e) {
        if ((e as any).statusCode === 409) throw e;
        logger.warn('summaryCheck 失败，忽略：', e);
      }
    }

    // autoSummarize logic
    if (autoSummarize === true) {
      try {
        const summary = await summarizeNoteMeta(note.content);
        const freshNote = await Note.findById(noteId);
        if (freshNote) {
          const freshUpdatedTime = new Date(freshNote.updatedAt).getTime();
          const originalUpdatedTime = new Date(note.updatedAt).getTime();
          
          let shouldApplyAISummary = true;
          if (freshUpdatedTime !== originalUpdatedTime) {
            const isTitleDefault = !freshNote.title || 
                                  freshNote.title === '未命名笔记' || 
                                  freshNote.title === (freshNote.contentText || '').split('\n')[0].trim().slice(0, 100);
            const isKeywordsEmpty = !freshNote.keywords || freshNote.keywords.length === 0;

            if (!isTitleDefault && !isKeywordsEmpty) {
              logger.warn(`autoSummarize 期间发生实质性并发修改（用户已修改标题/关键词），放弃更新。ID: ${noteId}`);
              return freshNote as unknown as INote; // Return fresh note without AI update
            }
            logger.info(`autoSummarize 期间发生并发修改，但标题/关键词仍为默认，尝试合并更新。ID: ${noteId}`);
          }

          if (title !== undefined) freshNote.title = title.trim();
          if (contentText !== undefined) {
            freshNote.contentText = contentText;
            freshNote.content = contentText;
          } else if (content !== undefined) {
            freshNote.content = content;
            freshNote.contentText = content;
            freshNote.contentJson = null;
          }
          if (contentJson !== undefined) {
            freshNote.contentJson = contentJson;
          }
          if (keywords !== undefined) freshNote.keywords = keywords;

          (freshNote as any).embedding = [];
          (freshNote as any).recommendCache = null;
          
          const isTitleDefault = !freshNote.title || 
                                freshNote.title === '未命名笔记' || 
                                freshNote.title === (freshNote.contentText || '').split('\n')[0].trim().slice(0, 100);
          
          if (summary?.title && title === undefined && isTitleDefault) {
            freshNote.title = summary.title;
          }
          if (Array.isArray(summary?.keywords) && keywords === undefined && (!freshNote.keywords || freshNote.keywords.length === 0)) {
            freshNote.keywords = summary.keywords;
          }
          if (typeof summary?.summary === 'string') freshNote.summary = summary.summary;

          await freshNote.save();

          this.scheduleEmbeddingUpdate({
            noteId: freshNote._id.toString(),
            userId: userId,
            updatedAt: (freshNote as any).updatedAt,
            title: freshNote.title,
            content: freshNote.content,
            contentText: (freshNote as any).contentText,
          });
          
          return freshNote as unknown as INote;
        }
      } catch (e) {
        logger.warn('自动摘要失败，忽略：', e);
      }
    }

    await note.save();
    logger.info('✅ 笔记局部更新成功');

    if (contentChanged) {
      this.scheduleEmbeddingUpdate({
        noteId: note._id.toString(),
        userId: userId,
        updatedAt: (note as any).updatedAt,
        title: note.title,
        content: note.content,
        contentText: (note as any).contentText,
      });
    }

    return note as unknown as INote;
  }
}

export const noteService = new NoteService();

import { Request, Response, NextFunction } from 'express';
import { noteService } from '../services/noteService';
import { ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';

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
    const note = await noteService.createNote(user._id.toString(), req.body);
    ResponseHandler.success(res, note, '笔记创建成功', 201);
  }

  // DELETE /:id
  async deleteNote(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
    const user = await UserValidator.authenticateUser(req);
    await noteService.deleteNote(user._id.toString(), id);
    ResponseHandler.success(res, null, '笔记删除成功');
  }

  // POST /:id/embed
  async generateEmbedding(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
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
    const { id } = req.params;
    const { title } = req.body;
    const user = await UserValidator.authenticateUser(req);
    const note = await noteService.updateTitle(user._id.toString(), id, title);
    ResponseHandler.success(res, { note }, '笔记标题更新成功');
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
    const { id } = req.params;
    const user = await UserValidator.authenticateUser(req);
    const summary = await noteService.regenerateSummary(user._id.toString(), id);
    ResponseHandler.success(res, { summary }, 'summary 生成成功');
  }

  // PATCH /:id
  async updateNote(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
    const user = await UserValidator.authenticateUser(req);
    try {
        const note = await noteService.updateNote(user._id.toString(), id, req.body);
        
        // Check if autoSummarize was requested to provide a specific message
        const { autoSummarize } = req.body;
        const message = autoSummarize ? '笔记更新成功（含自动摘要）' : '笔记更新成功';
        
        ResponseHandler.success(res, { note }, message);
    } catch (error: any) {
        if (error.statusCode === 409) {
             res.status(409).json({ success: false, error: error.message, data: error.data });
        } else {
             throw error;
        }
    }
  }
}

export const noteController = new NoteController();

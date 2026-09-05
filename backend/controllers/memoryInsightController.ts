import type { Request, Response } from 'express';
import { memoryInsightService } from '../services/memoryInsightService';
import { ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { trackProductEventBestEffort } from '../services/productEventService';

async function userId(req: Request) {
  const user = await UserValidator.authenticateUser(req as any);
  return user._id.toString();
}

export const memoryInsightController = {
  async generate(req: Request, res: Response) {
    const id = await userId(req);
    ResponseHandler.success(res, await memoryInsightService.generateProposals(id), '已从允许参与 AI 的笔记中整理候选记忆');
  },
  async list(req: Request, res: Response) {
    const id = await userId(req); trackProductEventBestEffort({ name: 'memory_viewed', userId: id, source: 'server', properties: {} });
    ResponseHandler.success(res, { insights: await memoryInsightService.list(id) });
  },
  async confirm(req: Request, res: Response) {
    const id = await userId(req); trackProductEventBestEffort({ name: 'memory_confirmed', userId: id, source: 'server', properties: {} });
    ResponseHandler.success(res, { insight: await memoryInsightService.confirm(id, String(req.params.id)) });
  },
  async correct(req: Request, res: Response) {
    const id = await userId(req); trackProductEventBestEffort({ name: 'memory_corrected', userId: id, source: 'server', properties: {} });
    ResponseHandler.success(res, { insight: await memoryInsightService.correct(id, String(req.params.id), req.body.correction) });
  },
  async remove(req: Request, res: Response) {
    const id = await userId(req); await memoryInsightService.delete(id, String(req.params.id));
    trackProductEventBestEffort({ name: 'memory_deleted', userId: id, source: 'server', properties: {} });
    ResponseHandler.success(res, null, 'AI 记忆已删除');
  },
  async getPreference(req: Request, res: Response) {
    ResponseHandler.success(res, await memoryInsightService.getNotePreference(await userId(req), String(req.params.noteId)));
  },
  async setPreference(req: Request, res: Response) {
    const id = await userId(req); trackProductEventBestEffort({ name: 'note_ai_preference_changed', userId: id, source: 'server', properties: { included: req.body.included } });
    ResponseHandler.success(res, await memoryInsightService.setNotePreference(id, String(req.params.noteId), req.body.included));
  },
};

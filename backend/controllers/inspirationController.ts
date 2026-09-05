import type { Request, Response } from 'express';
import { inspirationService } from '../services/inspirationService';
import { ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { trackProductEventBestEffort } from '../services/productEventService';
import { getClientIp } from '../services/auth/authContext';
import { assertInspirationRequestAllowed } from '../services/inspirationRateLimit';
async function user(req: Request) { return (await UserValidator.authenticateUser(req as any))._id.toString(); }
export const inspirationController = {
  async list(req: Request, res: Response) { ResponseHandler.success(res, { inspirations: await inspirationService.list(await user(req)) }); },
  async generate(req: Request, res: Response) { const id = await user(req); assertInspirationRequestAllowed(id, getClientIp(req)); trackProductEventBestEffort({ name: 'inspiration_requested', userId: id, source: 'server', properties: {} }); ResponseHandler.success(res, await inspirationService.request(id), '灵感任务已创建', 202); },
  async job(req: Request, res: Response) { ResponseHandler.success(res, { job: await inspirationService.job(await user(req), String(req.params.jobId)) }); },
  async status(req: Request, res: Response) { const id = await user(req); const status = req.body.status; if (status === 'saved' || status === 'dismissed') trackProductEventBestEffort({ name: status === 'saved' ? 'inspiration_saved' : 'inspiration_dismissed', userId: id, source: 'server', properties: {} }); ResponseHandler.success(res, { inspiration: await inspirationService.updateStatus(id, String(req.params.id), status) }); },
  async getSettings(req: Request, res: Response) { ResponseHandler.success(res, await inspirationService.settings(await user(req))); },
  async setSettings(req: Request, res: Response) { ResponseHandler.success(res, await inspirationService.saveSettings(await user(req), req.body.proactiveEnabled)); },
};

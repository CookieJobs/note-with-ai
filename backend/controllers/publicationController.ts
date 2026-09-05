import type { Request, Response } from 'express';
import { publicationService } from '../services/publicationService';
import { ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { trackProductEventBestEffort } from '../services/productEventService';
async function owner(req: Request) { return (await UserValidator.authenticateUser(req as any))._id.toString(); }
export const publicationController = {
  async create(req: Request, res: Response) { const id = await owner(req); trackProductEventBestEffort({ name: 'publication_created', userId: id, source: 'server', properties: {} }); ResponseHandler.success(res, { publication: await publicationService.create(id, req.body.noteId) }, '公开链接已创建', 201); },
  async list(req: Request, res: Response) { ResponseHandler.success(res, { publications: await publicationService.list(await owner(req)) }); },
  async refresh(req: Request, res: Response) { const id = await owner(req); trackProductEventBestEffort({ name: 'publication_snapshot_updated', userId: id, source: 'server', properties: {} }); ResponseHandler.success(res, { publication: await publicationService.refresh(id, String(req.params.id)) }); },
  async revoke(req: Request, res: Response) { const id = await owner(req); await publicationService.revoke(id, String(req.params.id)); trackProductEventBestEffort({ name: 'publication_revoked', userId: id, source: 'server', properties: {} }); ResponseHandler.success(res, null, '公开链接已撤销'); },
  async publicGet(req: Request, res: Response) {
    const publication = await publicationService.getPublic(String(req.params.slug));
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    ResponseHandler.success(res, { publication });
  },
};

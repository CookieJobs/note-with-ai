import express from 'express';
import { asyncHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminPermission } from '../../middleware/adminAuth';
import { listAudits } from '../../services/admin/adminUserService';

const router = express.Router();
router.get('/', requireAdmin, requireAdminPermission('audit:read'), asyncHandler(async (req, res) => {
  const q = req.query; ResponseHandler.success(res, await listAudits({ actorId: typeof q.actorId === 'string' ? q.actorId : undefined, action: typeof q.action === 'string' ? q.action : undefined, status: q.status === 'pending' || q.status === 'succeeded' || q.status === 'failed' ? q.status : undefined, from: typeof q.from === 'string' ? q.from : undefined, to: typeof q.to === 'string' ? q.to : undefined, page: Number(q.page ?? 1), limit: Number(q.limit ?? 20) }));
}));
export default router;

import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminPermission } from '../../middleware/adminAuth';
import { listAudits } from '../../services/admin/adminUserService';
import { validateAdminDateRange } from '../../utils/adminQueryValidation';

const router = express.Router();
router.get('/', requireAdmin, requireAdminPermission('audit:read'), asyncHandler(async (req, res) => {
  const q = req.query; const page = Number(q.page ?? 1); const limit = Number(q.limit ?? 20); if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw ErrorHandler.createValidationError('分页参数无效'); if (q.status !== undefined && !['pending', 'succeeded', 'failed'].includes(String(q.status))) throw ErrorHandler.createValidationError('status 无效'); if (q.actorId !== undefined && (typeof q.actorId !== 'string' || !mongoose.Types.ObjectId.isValid(q.actorId))) throw ErrorHandler.createValidationError('actorId 无效'); validateAdminDateRange(q.from, q.to); ResponseHandler.success(res, await listAudits({ actorId: typeof q.actorId === 'string' ? q.actorId : undefined, action: typeof q.action === 'string' ? q.action : undefined, status: q.status === 'pending' || q.status === 'succeeded' || q.status === 'failed' ? q.status : undefined, from: typeof q.from === 'string' ? q.from : undefined, to: typeof q.to === 'string' ? q.to : undefined, page, limit }));
}));
export default router;

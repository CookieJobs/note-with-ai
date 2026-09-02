import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminMutationOrigin, requireAdminPermission } from '../../middleware/adminAuth';
import { listFeedback, updateFeedback } from '../../services/admin/adminFeedbackService';
import { runAuditedAdminCommand } from '../../services/admin/adminAuditService';
import { validateAdminDateRange } from '../../utils/adminQueryValidation';
const router = express.Router();
router.use(requireAdmin, requireAdminPermission('feedback:read'));
router.get('/', asyncHandler(async (req, res) => { const q = req.query; const page = Number(q.page ?? 1); const limit = Number(q.limit ?? 20); if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw ErrorHandler.createValidationError('分页参数无效'); if (q.status !== undefined && !['new', 'in_progress', 'resolved', 'closed'].includes(String(q.status))) throw ErrorHandler.createValidationError('status 无效'); if (q.category !== undefined && !['bug', 'feature', 'other'].includes(String(q.category))) throw ErrorHandler.createValidationError('category 无效'); for (const value of [q.userId, q.assignedTo]) if (value !== undefined && (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value))) throw ErrorHandler.createValidationError('用户 ID 无效'); validateAdminDateRange(q.from, q.to); ResponseHandler.success(res, await listFeedback({ status: q.status as any, category: q.category as any, userId: typeof q.userId === 'string' ? q.userId : undefined, assignedTo: typeof q.assignedTo === 'string' ? q.assignedTo : undefined, assignedToSelf: q.assignedToSelf === 'true', adminId: req.admin!.id, page, limit, from: typeof q.from === 'string' ? q.from : undefined, to: typeof q.to === 'string' ? q.to : undefined })); }));
router.patch('/:id', requireAdminPermission('feedback:write'), requireAdminMutationOrigin, asyncHandler(async (req, res) => {
  const body = req.body ?? {}; const allowed = ['status', 'internalNote', 'assignedTo']; if (!Object.keys(body).some((key) => allowed.includes(key))) throw ErrorHandler.createValidationError('至少修改一个字段');
  if (body.status !== undefined && !['new', 'in_progress', 'resolved', 'closed'].includes(body.status)) throw ErrorHandler.createValidationError('反馈状态无效');
  if (body.internalNote !== undefined && (typeof body.internalNote !== 'string' || body.internalNote.length > 2000)) throw ErrorHandler.createValidationError('内部备注无效');
  const result = await runAuditedAdminCommand({ actorId: req.admin!.id, requestId: req.requestId, action: 'feedback.updated', targetType: 'UserFeedback', targetId: req.params.id, metadata: { changedFields: Object.keys(body).join(',') } }, () => updateFeedback(req.params.id, { status: body.status, internalNote: body.internalNote, assignedTo: body.assignedTo === undefined ? undefined : (body.assignedTo || null) }, req.admin!.role));
  ResponseHandler.success(res, result);
}));
export default router;

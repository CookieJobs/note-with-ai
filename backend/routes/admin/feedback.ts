import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminMutationOrigin, requireAdminPermission } from '../../middleware/adminAuth';
import { listFeedback, updateFeedback } from '../../services/admin/adminFeedbackService';
import { runAuditedAdminCommand } from '../../services/admin/adminAuditService';
import { validateAdminDateRange } from '../../utils/adminQueryValidation';
const router = express.Router();
router.use(requireAdmin, requireAdminPermission('feedback:read'));
router.get('/', asyncHandler(async (req, res) => { const q = req.query; const page = Number(q.page ?? 1); const limit = Number(q.limit ?? 20); if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw ErrorHandler.createValidationError('分页参数无效'); if (q.status !== undefined && !['open', 'in_progress', 'resolved'].includes(String(q.status))) throw ErrorHandler.createValidationError('status 无效'); if (q.category !== undefined && !['bug', 'experience', 'feature', 'billing', 'other'].includes(String(q.category))) throw ErrorHandler.createValidationError('category 无效'); if (q.userId !== undefined && (typeof q.userId !== 'string' || !mongoose.Types.ObjectId.isValid(q.userId))) throw ErrorHandler.createValidationError('用户 ID 无效'); validateAdminDateRange(q.from, q.to); ResponseHandler.success(res, await listFeedback({ status: q.status as any, category: q.category as any, userId: typeof q.userId === 'string' ? q.userId : undefined, assignedToSelf: q.assignedToSelf === 'true', adminId: req.admin!.id, page, limit, from: typeof q.from === 'string' ? q.from : undefined, to: typeof q.to === 'string' ? q.to : undefined })); }));
router.patch('/:id', requireAdminPermission('feedback:write'), requireAdminMutationOrigin, asyncHandler(async (req, res) => {
  const body = req.body ?? {}; const allowed = ['status', 'internalNote', 'assignedToSelf']; if (!Object.keys(body).some((key) => allowed.includes(key)) || Object.keys(body).some(key => !allowed.includes(key))) throw ErrorHandler.createValidationError('反馈更新字段无效');
  if (body.status !== undefined && !['open', 'in_progress', 'resolved'].includes(body.status)) throw ErrorHandler.createValidationError('反馈状态无效');
  if (body.internalNote !== undefined && (typeof body.internalNote !== 'string' || body.internalNote.length > 2000)) throw ErrorHandler.createValidationError('内部备注无效');
  const result = await runAuditedAdminCommand({ actorId: req.admin!.id, requestId: req.requestId, action: 'feedback.updated', targetType: 'UserFeedback', targetId: req.params.id, metadata: { changedFields: Object.keys(body).join(',') } }, () => updateFeedback(req.params.id, { status: body.status, internalNote: body.internalNote, assignedToSelf: body.assignedToSelf }, req.admin!.id, req.admin!.role));
  ResponseHandler.success(res, result);
}));
export default router;

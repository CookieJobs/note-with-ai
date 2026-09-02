import express from 'express';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminMutationOrigin, requireAdminPermission } from '../../middleware/adminAuth';
import { getUser, listUsers, setUserActive } from '../../services/admin/adminUserService';
import { runAuditedAdminCommand } from '../../services/admin/adminAuditService';
import { validateAdminDateRange } from '../../utils/adminQueryValidation';

const router = express.Router();
router.use(requireAdmin, requireAdminPermission('users:read'));
router.get('/', asyncHandler(async (req, res) => {
  const raw = req.query; const limit = raw.limit === undefined ? 20 : Number(raw.limit);
  const page = raw.page === undefined ? 1 : Number(raw.page);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(page) || page < 1) throw ErrorHandler.createValidationError('分页参数无效');
  if (raw.status !== undefined && raw.status !== 'active' && raw.status !== 'disabled') throw ErrorHandler.createValidationError('status 无效');
  validateAdminDateRange(raw.from, raw.to);
  const data = await listUsers({ query: typeof raw.query === 'string' ? raw.query : undefined, status: raw.status === 'active' || raw.status === 'disabled' ? raw.status : undefined, from: typeof raw.from === 'string' ? raw.from : undefined, to: typeof raw.to === 'string' ? raw.to : undefined, page, limit, role: req.admin!.role });
  ResponseHandler.success(res, data);
}));
router.get('/:id', asyncHandler(async (req, res) => ResponseHandler.success(res, await getUser(req.params.id, req.admin!.role))));
router.patch('/:id/status', requireAdminPermission('users:status'), requireAdminMutationOrigin, asyncHandler(async (req, res) => {
  const { isActive, reason } = req.body ?? {};
  if (typeof isActive !== 'boolean' || typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 200) throw ErrorHandler.createValidationError('状态变更原因需为 5-200 个字符');
  const result = await runAuditedAdminCommand({ actorId: req.admin!.id, requestId: req.requestId, action: 'user.status_changed', targetType: 'User', targetId: req.params.id, metadata: { reason: reason.trim(), nextStatus: isActive ? 'active' : 'disabled' }, resultMetadata: { idempotent: false } }, () => setUserActive(req.params.id, isActive));
  ResponseHandler.success(res, result);
}));
export default router;

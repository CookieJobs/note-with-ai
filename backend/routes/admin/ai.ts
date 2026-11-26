import express from 'express';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminMutationOrigin, requireAdminPermission } from '../../middleware/adminAuth';
import { getAiUsage, listFailedArtifacts, retryFailedArtifact } from '../../services/admin/adminAiService';
import { getNoteDiscoveryBillingForm, getNoteDiscoveryEnvironment, saveNoteDiscoveryBilling, setNoteDiscoveryEnvironment } from '../../services/noteDiscoveryEnvironment';
import { runAuditedAdminCommand } from '../../services/admin/adminAuditService';
const router = express.Router();
router.use(requireAdmin, requireAdminPermission('ai:read'));
router.get('/note-discovery-status', asyncHandler(async (_req, res) => {
  ResponseHandler.success(res, await getNoteDiscoveryEnvironment());
}));
router.post('/note-discovery-status', requireAdminPermission('ai:discovery_manage'), requireAdminMutationOrigin, asyncHandler(async (req, res) => {
  const { enabled, reason } = req.body ?? {};
  if (typeof enabled !== 'boolean' || typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 200) {
    throw ErrorHandler.createValidationError('请提供明确的开关状态和 5-200 个字符的变更原因');
  }
  const result = await runAuditedAdminCommand({
    actorId: req.admin!.id,
    requestId: req.requestId,
    action: 'ai.note_discovery_environment_changed',
    targetType: 'NoteDiscoveryEnvironment',
    targetId: 'note-discovery',
    metadata: { reason: reason.trim(), nextStatus: enabled ? 'enabled' : 'disabled' },
  }, () => setNoteDiscoveryEnvironment(enabled));
  ResponseHandler.success(res, result);
}));
router.get('/note-discovery-billing', requireAdminPermission('ai:discovery_manage'), asyncHandler(async (_req, res) => {
  ResponseHandler.success(res, await getNoteDiscoveryBillingForm());
}));
router.post('/note-discovery-billing', requireAdminPermission('ai:discovery_manage'), requireAdminMutationOrigin, asyncHandler(async (req, res) => {
  const { reason } = req.body ?? {};
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 200) {
    throw ErrorHandler.createValidationError('请填写 5-200 个字符的变更原因');
  }
  const result = await runAuditedAdminCommand({
    actorId: req.admin!.id, requestId: req.requestId, action: 'ai.note_discovery_billing_changed',
    targetType: 'NoteDiscoveryEnvironment', targetId: 'note-discovery',
    metadata: { reason: reason.trim() },
  }, () => saveNoteDiscoveryBilling(req.body));
  ResponseHandler.success(res, result);
}));
router.get('/usage', asyncHandler(async (req, res) => { const range = req.query.range === '30d' ? '30d' : req.query.range === '7d' || req.query.range === undefined ? '7d' : null; if (!range) throw ErrorHandler.createValidationError('range must be 7d or 30d'); ResponseHandler.success(res, await getAiUsage({ range })); }));
router.get('/failures', asyncHandler(async (req, res) => { const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 20); if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw ErrorHandler.createValidationError('分页参数无效'); ResponseHandler.success(res, await listFailedArtifacts({ page, limit })); }));
router.post('/failures/:noteId/retry', requireAdminPermission('ai:retry'), requireAdminMutationOrigin, asyncHandler(async (req, res) => { const body = req.body ?? {}; const input = { ...body, noteId: req.params.noteId }; const result = await runAuditedAdminCommand({ actorId: req.admin!.id, requestId: req.requestId, action: 'ai.artifact_retry', targetType: 'Note', targetId: req.params.noteId, metadata: { reason: typeof body.reason === 'string' ? body.reason.trim() : '', sourceRevision: Number(body.expectedRevision) } }, () => retryFailedArtifact(input)); ResponseHandler.success(res, result); }));
export default router;

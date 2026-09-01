import express from 'express';
import { getSystemHealth } from '../../services/admin/adminOverviewService';
import { asyncHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminPermission } from '../../middleware/adminAuth';

const router = express.Router();
router.get('/health', requireAdmin, requireAdminPermission('system:read'), asyncHandler(async (_req, res) => {
  ResponseHandler.success(res, await getSystemHealth());
}));
export default router;

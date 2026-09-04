import express from 'express';
import { getOverview } from '../../services/admin/adminOverviewService';
import { asyncHandler, ResponseHandler } from '../../utils/errorHandler';
import { requireAdmin, requireAdminPermission } from '../../middleware/adminAuth';

const router = express.Router();
router.get('/', requireAdmin, requireAdminPermission('overview:read'), asyncHandler(async (req, res) => {
  const raw = req.query.range;
  const range = raw === undefined ? '7d' : raw;
  if (range !== '7d' && range !== '30d') return res.status(400).json({ success: false, message: 'range must be 7d or 30d', data: undefined });
  ResponseHandler.success(res, await getOverview({ range }));
}));
export default router;

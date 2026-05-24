import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { getStats } from '../controllers/userController';

const router = express.Router();

router.get('/stats', authenticateToken, asyncHandler(async (req, res) => {
  await getStats(req, res);
}));

export default router;

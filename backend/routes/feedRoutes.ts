import express from 'express';
import { getFeed, triggerAnalysis } from '../controllers/feedController';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';

const router = express.Router();

// GET /api/feed - Get personalized feed
router.get('/', authenticateToken, asyncHandler(getFeed));

// POST /api/feed/analyze - Trigger profile analysis manually
router.post('/analyze', authenticateToken, asyncHandler(triggerAnalysis));

export default router;

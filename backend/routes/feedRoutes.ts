import express from 'express';
import { getFeed, triggerAnalysis } from '../controllers/feedController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// GET /api/feed - Get personalized feed
router.get('/', authenticateToken, getFeed);

// POST /api/feed/analyze - Trigger profile analysis manually
router.post('/analyze', authenticateToken, triggerAnalysis);

export default router;

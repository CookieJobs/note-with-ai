import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { getProfileAnalysis, requestProfileAnalysis, getProfileTopics, retryProfileTopics } from '../controllers/profileController';

const router = express.Router();

router.get('/analysis', authenticateToken, asyncHandler(getProfileAnalysis));
router.post('/analysis', authenticateToken, asyncHandler(requestProfileAnalysis));
router.get('/topics', authenticateToken, asyncHandler(getProfileTopics));
router.post('/topics/retry', authenticateToken, asyncHandler(retryProfileTopics));

export default router;

import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { getProfileAnalysis, requestProfileAnalysis } from '../controllers/profileController';

const router = express.Router();

router.get('/analysis', authenticateToken, asyncHandler(getProfileAnalysis));
router.post('/analysis', authenticateToken, asyncHandler(requestProfileAnalysis));

export default router;

import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { validate } from '../middleware/validate';
import { inspirationController } from '../controllers/inspirationController';
import { z } from 'zod';
const router = express.Router();
const status = z.object({ params: z.object({ id: z.string().min(1) }), body: z.object({ status: z.enum(['read', 'saved', 'dismissed']) }) });
const job = z.object({ params: z.object({ jobId: z.string().min(1) }) });
router.get('/', authenticateToken, asyncHandler(inspirationController.list));
router.post('/generate', authenticateToken, asyncHandler(inspirationController.generate));
router.get('/jobs/:jobId', authenticateToken, validate(job), asyncHandler(inspirationController.job));
router.patch('/:id/status', authenticateToken, validate(status), asyncHandler(inspirationController.status));
export default router;


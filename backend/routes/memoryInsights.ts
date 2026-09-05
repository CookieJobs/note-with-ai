import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { validate } from '../middleware/validate';
import { memoryInsightController } from '../controllers/memoryInsightController';
import { correctionSchema, memoryIdSchema } from '../schemas/memorySchemas';

const router = express.Router();
router.get('/', authenticateToken, asyncHandler(memoryInsightController.list));
router.post('/generate', authenticateToken, asyncHandler(memoryInsightController.generate));
router.post('/:id/confirm', authenticateToken, validate(memoryIdSchema), asyncHandler(memoryInsightController.confirm));
router.patch('/:id/correction', authenticateToken, validate(correctionSchema), asyncHandler(memoryInsightController.correct));
router.delete('/:id', authenticateToken, validate(memoryIdSchema), asyncHandler(memoryInsightController.remove));
export default router;

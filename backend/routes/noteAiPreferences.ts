import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { validate } from '../middleware/validate';
import { memoryInsightController } from '../controllers/memoryInsightController';
import { notePreferenceParamSchema, notePreferenceSchema } from '../schemas/memorySchemas';

const router = express.Router();
router.get('/:noteId', authenticateToken, validate(notePreferenceParamSchema), asyncHandler(memoryInsightController.getPreference));
router.put('/:noteId', authenticateToken, validate(notePreferenceSchema), asyncHandler(memoryInsightController.setPreference));
export default router;


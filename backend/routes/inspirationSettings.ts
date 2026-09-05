import express from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { validate } from '../middleware/validate';
import { inspirationController } from '../controllers/inspirationController';
const router = express.Router();
router.get('/', authenticateToken, asyncHandler(inspirationController.getSettings));
router.put('/', authenticateToken, validate(z.object({ body: z.object({ proactiveEnabled: z.boolean() }) })), asyncHandler(inspirationController.setSettings));
export default router;


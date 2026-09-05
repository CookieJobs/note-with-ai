import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { validate } from '../middleware/validate';
import { publicationController } from '../controllers/publicationController';
import { createPublicationSchema, publicationIdSchema, publicSlugSchema } from '../schemas/publicationSchemas';
const router = express.Router();
router.post('/', authenticateToken, validate(createPublicationSchema), asyncHandler(publicationController.create));
router.get('/mine', authenticateToken, asyncHandler(publicationController.list));
router.patch('/:id/snapshot', authenticateToken, validate(publicationIdSchema), asyncHandler(publicationController.refresh));
router.delete('/:id', authenticateToken, validate(publicationIdSchema), asyncHandler(publicationController.revoke));
router.get('/public/:slug', validate(publicSlugSchema), asyncHandler(publicationController.publicGet));
export default router;


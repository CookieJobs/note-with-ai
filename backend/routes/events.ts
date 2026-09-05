import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { ProductEventService } from '../services/productEventService';
import { UserValidator } from '../utils/userValidation';

const router = express.Router();

router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const body = req.body;
  const validAssociation = body?.name === 'association_opened' && body?.properties && Object.keys(body.properties).length === 1 && ['notes', 'chat'].includes(body.properties.surface);
  const validMemoryEvidence = body?.name === 'memory_evidence_opened' && body?.properties && Object.keys(body.properties).length === 1 && typeof body.properties.memoryId === 'string' && body.properties.memoryId.length <= 100;
  const validInspirationSource = body?.name === 'inspiration_source_opened' && body?.properties && Object.keys(body.properties).length === 1 && typeof body.properties.inspirationId === 'string' && body.properties.inspirationId.length <= 100;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 || !body.properties || typeof body.properties !== 'object' || Array.isArray(body.properties)
    || (!validAssociation && !validMemoryEvidence && !validInspirationSource)) {
    throw ErrorHandler.createValidationError('事件请求无效');
  }
  const user = await UserValidator.validateAndGetUser(req);
  await ProductEventService.recordWebEvent(user._id.toString(), body.name, body.properties);
  ResponseHandler.success(res, null, '事件已接收', 202);
}));

export default router;

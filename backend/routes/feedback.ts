import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../utils/errorHandler';
import { submitFeedback } from '../services/admin/adminFeedbackService';
import { UserValidator } from '../utils/userValidation';

const router = express.Router();
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const { content, category, contact, appVersion } = req.body ?? {};
  if (typeof content !== 'string' || content.trim().length < 5 || content.trim().length > 2000 || !['bug', 'feature', 'other'].includes(category) || (contact !== undefined && (typeof contact !== 'string' || contact.length > 200)) || (appVersion !== undefined && (typeof appVersion !== 'string' || appVersion.length > 50))) throw ErrorHandler.createValidationError('反馈内容无效');
  const user = await UserValidator.validateAndGetUser(req);
  ResponseHandler.success(res, await submitFeedback({ userId: user._id.toString(), content: content.trim(), category, contact, appVersion }), '反馈已提交', 201);
}));
export default router;

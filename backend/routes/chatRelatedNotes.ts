
/*
Input: messages + threshold + limit + excludeNoteId
Output: relatedNotes + count
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { validate } from '../middleware/validate';
import { contextRelatedNotesSchema } from '../schemas/chatSchemas';
import { chatRelatedNoteRecallService } from '../services/chatRelatedNoteRecallService';

const router = express.Router();

/**
 * 基于对话上下文获取相关笔记
 * POST /api/chat/context-related-notes
 */
router.post(
  '/context-related-notes',
  authenticateToken,
  validate(contextRelatedNotesSchema),
  asyncHandler(async (req, res): Promise<void> => {
    const user = await UserValidator.authenticateUser(req);
    const { messages, threshold = 0.3, limit = 5, excludeNoteId } = req.body;

    const relatedNotes = await chatRelatedNoteRecallService.recallFromMessages({
      userId: user._id.toString(),
      messages,
      threshold,
      limit,
      excludeNoteId,
    });

    return ResponseHandler.success(res, {
      relatedNotes,
      count: relatedNotes.length,
    });
  })
);

export default router;

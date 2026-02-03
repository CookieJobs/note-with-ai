/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
import express from 'express';
import { findRelatedNotes } from '../utils/embedding';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';

const router = express.Router();

/**
 * 获取与聊天消息相关的笔记
 * POST /api/chat/related-notes
 */
router.post('/related-notes', authenticateToken, asyncHandler(async (req, res): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const { message, threshold = 0.3, limit = 3, excludeNoteId } = req.body;

  if (!message || typeof message !== 'string') {
    throw ErrorHandler.createValidationError('消息内容不能为空');
  }

  // 查找相关笔记
  const relatedNotes = await findRelatedNotes(
    message,
    user._id.toString(),
    threshold,
    limit,
    excludeNoteId
  );

  const responseData = {
    relatedNotes,
    query: message,
    threshold,
    count: relatedNotes.length
  };

  return ResponseHandler.success(res, responseData);
}));

/**
 * 批量获取多条消息的相关笔记
 * POST /api/chat/batch-related-notes
 */
router.post('/batch-related-notes', authenticateToken, asyncHandler(async (req, res): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const { messages, threshold = 0.7, limit = 3 } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw ErrorHandler.createValidationError('消息列表不能为空');
  }

  // 批量处理消息
  const results = await Promise.all(
    messages.map(async (message: string, index: number) => {
      try {
        const relatedNotes = await findRelatedNotes(
          message,
          user._id.toString(),
          threshold,
          limit
        );
        return {
          messageIndex: index,
          message,
          relatedNotes,
          count: relatedNotes.length
        };
      } catch (error) {
        console.error(`❌ 处理消息 ${index} 失败:`, error);
        return {
          messageIndex: index,
          message,
          relatedNotes: [],
          count: 0,
          error: '处理失败'
        };
      }
    })
  );

  const responseData = {
    results,
    threshold,
    totalMessages: messages.length,
    totalRelatedNotes: results.reduce((sum, r) => sum + r.count, 0)
  };

  return ResponseHandler.success(res, responseData);
}));

/**
 * 基于对话上下文获取相关笔记
 * POST /api/chat/context-related-notes
 */
router.post('/context-related-notes', authenticateToken, asyncHandler(async (req, res): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const { messages, threshold = 0.2, limit = 5 } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw ErrorHandler.createValidationError('消息列表不能为空');
  }

  // 构建上下文：取最后 6 条消息
  const lastMessages = messages.slice(-6);
  const context = lastMessages.map((m: any) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`).join('\n');

  // 查找相关笔记
  const relatedNotes = await findRelatedNotes(
    context,
    user._id.toString(),
    threshold,
    limit
  );

  // 格式化返回数据，确保符合前端 RelatedNote 接口
  const formattedNotes = relatedNotes.map(item => ({
    noteId: item.note._id,
    title: item.note.title,
    content: item.note.content,
    score: item.score,
    matchType: item.matchType,
    createdAt: item.note.createdAt
  }));

  return ResponseHandler.success(res, {
    relatedNotes: formattedNotes,
    count: formattedNotes.length
  });
}));

export default router;
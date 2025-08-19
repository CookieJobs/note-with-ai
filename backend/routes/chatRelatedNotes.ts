import express from 'express';
import { findRelatedNotes } from '../utils/embedding';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

/**
 * 获取与聊天消息相关的笔记
 * POST /api/chat/related-notes
 */
router.post('/related-notes', authenticateToken, async (req, res): Promise<void> => {
  try {
    const { message, threshold = 0.7, limit = 3 } = req.body;
    const userId = req.user?.userId;

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        message: '消息内容不能为空'
      });
      return;
    }

    if (!userId) {
      res.status(401).json({
        success: false,
        message: '用户未认证'
      });
      return;
    }

    // 查找相关笔记
    const relatedNotes = await findRelatedNotes(
      message,
      userId,
      threshold,
      limit
    );

    res.json({
      success: true,
      data: {
        relatedNotes,
        query: message,
        threshold,
        count: relatedNotes.length
      }
    });

  } catch (error: any) {
    console.error('❌ 获取相关笔记失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * 批量获取多条消息的相关笔记
 * POST /api/chat/batch-related-notes
 */
router.post('/batch-related-notes', authenticateToken, async (req, res): Promise<void> => {
  try {
    const { messages, threshold = 0.7, limit = 2 } = req.body;
    const userId = req.user?.userId;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        success: false,
        message: '消息列表不能为空'
      });
      return;
    }

    if (!userId) {
      res.status(401).json({
        success: false,
        message: '用户未认证'
      });
      return;
    }

    // 批量处理消息
    const results = await Promise.all(
      messages.map(async (message: string, index: number) => {
        try {
          const relatedNotes = await findRelatedNotes(
            message,
            userId,
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

    res.json({
      success: true,
      data: {
        results,
        threshold,
        totalMessages: messages.length,
        totalRelatedNotes: results.reduce((sum, r) => sum + r.count, 0)
      }
    });

  } catch (error: any) {
    console.error('❌ 批量获取相关笔记失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
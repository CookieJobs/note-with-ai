/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/routes/chat.ts
import express from 'express';
import { 
  saveChatSession, 
  getChatSessions, 
  deleteChatSession, 
  streamChat, 
  summarizeTitle, 
  generateIntro, 
  searchRelatedNotes 
} from '../controllers/chatController';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';

const router = express.Router();

// 保存聊天记录
router.post('/save', authenticateToken, asyncHandler(saveChatSession));

// 获取所有聊天记录
router.get('/sessions', authenticateToken, asyncHandler(getChatSessions));

// 删除聊天记录
router.delete('/:sessionId', authenticateToken, asyncHandler(deleteChatSession));

// 聊天标题自动摘要接口
router.post('/summarizeTitle', authenticateToken, asyncHandler(summarizeTitle));

// 发送给 DeepSeek 聊天接口（支持流式响应）
router.post('/', authenticateToken, asyncHandler(streamChat));

// 搜索相关笔记接口（异步调用）
router.post('/search-related-notes', authenticateToken, asyncHandler(searchRelatedNotes));

// AI 关怀助手开场白
router.get('/robot/intro', authenticateToken, asyncHandler(generateIntro));

export default router;

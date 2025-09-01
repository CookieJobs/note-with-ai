// backend/routes/chat.ts
import express from 'express';
import { chatWithDeepSeek, summarizeChatTitle } from '../services/deepseek';
import  Chat  from '../models/Chat';

import { authenticateToken } from '../middleware/auth';
import { findRelatedNotes, findRelatedNotesAdvanced } from '../utils/embedding';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../utils/errorHandler';

const router = express.Router();

// 简单的消息清洗与校验函数
function sanitizeMessages(messages: any[]): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .map(m => ({ role: m.role, content: m.content.trim() }));
}

// 保存聊天记录
router.post('/save', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { sessionId, messages, title } = req.body;
  const userId = req.user?.userId;

  console.log('💾 收到保存聊天记录请求:', { sessionId, messagesCount: messages?.length, title, userId });

  if (!Array.isArray(messages)) {
    throw ErrorHandler.createValidationError('messages 必须是数组');
  }

  if (!userId) {
    throw ErrorHandler.createAuthenticationError();
  }

  // 对消息进行清洗，移除无效项（如无 content 的 assistant 占位条目）
  const cleanedMessages = sanitizeMessages(messages);

  let chat;
  if (sessionId) {
    // 更新现有会话
    chat = await Chat.findByIdAndUpdate(
      sessionId,
      { messages: cleanedMessages, title, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!chat) {
      throw ErrorHandler.createNotFoundError('会话不存在');
    }
  } else {
    // 创建新会话
    chat = new Chat({ userId, messages: cleanedMessages, title: title || '新对话' });
    await chat.save();
  }

  ResponseHandler.success(res, { sessionId: chat._id }, '保存成功');
}));

// 获取所有聊天记录
router.get('/sessions', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const userId = req.user?.userId;

  if (!userId) {
    throw ErrorHandler.createAuthenticationError();
  }

  const sessions = await Chat.find({ userId }).sort({ updatedAt: -1 }).lean();
  
  // 映射 _id 为 id，避免前端处理混乱
  const formatted = sessions.map((s) => ({
    ...s,
    id: s._id.toString(),
    _id: s._id.toString(),
  }));
  
  ResponseHandler.success(res, { sessions: formatted }, '获取成功');
}));

// 删除聊天记录
router.delete('/:sessionId', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { sessionId } = req.params;
  const userId = req.user?.userId;

  console.log('🗑️ 收到删除聊天记录请求:', { sessionId, userId });

  if (!userId) {
    throw ErrorHandler.createAuthenticationError();
  }

  const result = await Chat.findOneAndDelete({ _id: sessionId, userId });
  if (!result) {
    throw ErrorHandler.createNotFoundError('会话不存在或无权限删除');
  }

  ResponseHandler.success(res, null, '删除成功');
}));

// 聊天标题自动摘要接口
router.post('/summarizeTitle', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { userContent, aiContent } = req.body;
  
  if (!userContent || !aiContent) {
    throw ErrorHandler.createValidationError('缺少内容');
  }
  
  // 拼接用户和AI内容作为摘要输入
  const prompt = `用户: ${userContent}\nAI: ${aiContent}`;
  const title = await summarizeChatTitle(prompt);
  
  ResponseHandler.success(res, { title }, '生成标题成功');
}));

// 发送给 DeepSeek 聊天接口
router.post('/', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { messages, sessionId, title } = req.body;
  const userId = req.user?.userId;

  console.log('🟢 收到聊天请求:', messages, sessionId, 'userId:', userId);

  if (!Array.isArray(messages) || messages.length === 0) {
    throw ErrorHandler.createValidationError('messages 不合法');
  }

  if (!userId) {
    throw ErrorHandler.createAuthenticationError();
  }

  // 清洗消息，确保发送到模型的格式正确
  const cleanedMessages = sanitizeMessages(messages);
  if (cleanedMessages.length === 0) {
    throw ErrorHandler.createValidationError('有效消息为空');
  }

  try {
    // 获取AI回复
    const reply = await chatWithDeepSeek(cleanedMessages);
    console.log('🤖 DeepSeek 回复:', reply);

    // 组合最终消息（包含 AI 回复）
    const finalMessages = [...cleanedMessages, { role: 'assistant' as const, content: reply }];

    // 保存到数据库（更新会话）
    if (sessionId) {
      await Chat.findByIdAndUpdate(
        sessionId,
        { messages: finalMessages, title: title || '新对话', updatedAt: new Date() },
        { new: true, runValidators: true }
      );
    } else {
      // 若无sessionId则新建会话
      const session = new Chat({ userId, title: title || '新对话', messages: finalMessages });
      await session.save();
    }

    ResponseHandler.success(res, { reply }, '聊天成功');
  } catch (error: any) {
    console.error('❌ 聊天接口错误:', error);
    // 如果是DeepSeek API错误，返回更具体的错误信息
    if (error.message && error.message.includes('API请求错误')) {
      throw ErrorHandler.createExternalApiError('AI服务暂时不可用，请稍后重试', 'DeepSeek');
    } else {
      throw ErrorHandler.createInternalError('聊天失败，请稍后重试');
    }
  }
}));

// 搜索相关笔记接口（异步调用）
router.post('/search-related-notes', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { userMessage, aiReply } = req.body;
  const userId = req.user?.userId;

  console.log('🔍 收到相关笔记搜索请求, userId:', userId);

  if (!userMessage || !aiReply) {
    throw ErrorHandler.createValidationError('缺少用户消息或AI回复');
  }

  if (!userId) {
    throw ErrorHandler.createAuthenticationError();
  }

  console.log('🔍 开始搜索相关笔记...');
  console.log('👤 用户消息:', userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''));
  console.log('🤖 AI回复:', aiReply.substring(0, 100) + (aiReply.length > 100 ? '...' : ''));
  
  // 使用性能监控获取用户的所有笔记
  const { Note } = await import('../models/Note');
  const { measureDatabaseQuery } = await import('../utils/performance');
  
  const userNotes = await measureDatabaseQuery(
    'search_user_notes_with_embedding',
    () => Note.find({ 
      userId, 
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    })
  );

  if (userNotes.length === 0) {
    console.log('⚠️ 用户没有包含向量的笔记');
    return ResponseHandler.success(res, { relatedNotes: [] }, '搜索完成');
  }

  console.log(`📚 用户共有 ${userNotes.length} 条包含向量的笔记`);
  
  // 使用性能监控的高级搜索方法
  const { measureEmbeddingOperation } = await import('../utils/performance');
  
  const relatedNotesResult = await measureEmbeddingOperation(
    'advanced_related_notes_search',
    () => findRelatedNotesAdvanced(
      userMessage, 
      aiReply, 
      userNotes, 
      {
        maxResults: 3,
        threshold: 0.3, // 从0.7降低到0.3，更宽松的匹配
        dimensions: 1024
      }
    ),
    userMessage.length + aiReply.length
  );
  const relatedNotes = relatedNotesResult || [];
  
  console.log('📝 找到相关笔记数量:', relatedNotes.length);
  if (relatedNotes.length > 0) {
    relatedNotes.forEach((item, index) => {
      console.log(`📄 笔记${index + 1}: "${item.note.title}" (相似度: ${(item.score * 100).toFixed(1)}%)`);
    });
  } else {
    console.log('⚠️ 没有找到相关笔记，可能是阈值过高或语义差异较大');
    // 显示所有笔记的相似度分数用于调试
    console.log('🔍 调试信息 - 所有笔记的相似度分数:');
    // 这里我们需要手动计算一下相似度来调试
  }

  const formattedNotes = relatedNotes.map(item => ({
    id: item.note._id,
    title: item.note.title,
    content: item.note.content,
    similarity: item.score,
    matchType: item.matchType,
    createdAt: item.note.createdAt
  }));

  ResponseHandler.success(res, { relatedNotes: formattedNotes }, '搜索相关笔记成功');
}));

export default router;

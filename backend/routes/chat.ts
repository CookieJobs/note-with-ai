/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/routes/chat.ts
import express from 'express';
import { chatWithDeepSeek, summarizeChatTitle } from '../services/deepseek';
import { Note } from '../models/Note';
import  Chat  from '../models/Chat';
import mongoose from 'mongoose';

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
  if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
    // 更新现有会话（仅当 sessionId 为有效 ObjectId 时）
    chat = await Chat.findByIdAndUpdate(
      sessionId,
      { messages: cleanedMessages, title: title || '新对话', updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!chat) {
      throw ErrorHandler.createNotFoundError('会话不存在');
    }
  } else if (sessionId && !mongoose.Types.ObjectId.isValid(sessionId)) {
    console.warn('⚠️ 无效的 sessionId，忽略更新并创建新会话:', sessionId);
    chat = new Chat({ userId, messages: cleanedMessages, title: title || '新对话' });
    await chat.save();
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

  // 兜底：若内容为空则直接返回默认标题，防止 400
  const userText = (userContent ?? '').toString().trim();
  const aiText = (aiContent ?? '').toString().trim();

  if (!userText && !aiText) {
    return ResponseHandler.success(res, { title: '未命名对话' }, '无内容，返回默认标题');
  }

  // 拼接用户和AI内容作为摘要输入（若只有一项，也可使用单项）
  const prompt = userText && aiText ? `用户: ${userText}\nAI: ${aiText}` : (userText || aiText);
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
    if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
      await Chat.findByIdAndUpdate(
        sessionId,
        { messages: finalMessages, title: title || '新对话', updatedAt: new Date() },
        { new: true, runValidators: true }
      );
    } else if (sessionId && !mongoose.Types.ObjectId.isValid(sessionId)) {
      console.warn('⚠️ 无效的 sessionId，忽略更新并创建新会话:', sessionId);
      const session = new Chat({ userId, title: title || '新对话', messages: finalMessages });
      await session.save();
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

// 将笔记内容拆分为片段（内容节点）
const splitContentIntoNodes = (content: string): string[] => {
  if (!content) return [];
  const roughParts = content
    .split(/\n+/)
    .flatMap(line => line.split(/[。！？!\?；;：:]/g))
    .map(s => s.trim())
    .filter(Boolean);
  return roughParts.filter(s => s.length >= 4 && s.length <= 200);
};

// AI 关怀助手开场白（迁移自 for-me）
router.get('/robot/intro', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const userId = req.user?.userId;
  const notes = await Note.find({ userId }).sort({ createdAt: -1 });

  if (!notes || notes.length === 0) {
    return ResponseHandler.success(res, {
      noteId: null,
      noteTitle: '',
      snippet: '',
      aiOpening: '我还没有看到你的任何笔记，要不要先去记录一点近期的想法或身体状况呢？'
    }, '暂无笔记');
  }

  const randomNote = notes[Math.floor(Math.random() * notes.length)];
  const nodes = splitContentIntoNodes(randomNote.content || '');
  if (!nodes || nodes.length === 0) {
    const fallbackSnippet = (randomNote.content || '').slice(0, 60);
    const prompt = `你将看到用户过往笔记中的一个片段，请用体贴、自然的语气发起一句关怀性中文开场白，最多60字，不要复述片段。片段:"${fallbackSnippet}"`;
    try {
      const aiOpening = await chatWithDeepSeek([
        { role: 'system', content: '你是一个富有洞察力且善于启发的思想伙伴。你的目标是通过回顾用户过去的笔记片段，提出一个有深度、能引发思考或激发表达欲的问题。尝试寻找片段背后的情绪、动机或潜在关联，而不仅仅是表面问候。' },
        { role: 'user', content: prompt }
      ]);
      return ResponseHandler.success(res, {
        noteId: randomNote._id.toString(),
        noteTitle: randomNote.title,
        snippet: fallbackSnippet,
        aiOpening
      }, '生成成功');
    } catch (_e) {
      const aiOpening = '最近还好吗？我注意到你曾记录了一些重要事项，想关心一下你的近况。';
      return ResponseHandler.success(res, {
        noteId: randomNote._id.toString(),
        noteTitle: randomNote.title,
        snippet: fallbackSnippet,
        aiOpening
      }, '生成成功(降级)');
    }
  }

  const snippet = nodes[Math.floor(Math.random() * nodes.length)];
  const system = '你是一个富有洞察力且善于启发的思想伙伴。你的目标是通过回顾用户过去的笔记片段，提出一个有深度、能引发思考或激发表达欲的问题。尝试寻找片段背后的情绪、动机或潜在关联，而不仅仅是表面问候。语气保持真诚、好奇且自然。最多60字。';
  const userMsg = `用户过往笔记片段:"${snippet}"。请基于此片段，构思一个能引发用户深层思考或分享欲望的简短开场白。可以是关于当时的感受、后续的思考，或者是对某个观点的进一步探讨。避免简单的寒暄。`;

  try {
    const aiOpening = await chatWithDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: userMsg }
    ]);
    return ResponseHandler.success(res, {
      noteId: randomNote._id.toString(),
      noteTitle: randomNote.title,
      snippet,
      aiOpening
    }, '生成成功');
  } catch (_e) {
    let aiOpening = '最近过得还好吗？看到你之前的记录，我想来问候一下。';
    if (/膝盖|膝关节/.test(snippet)) {
      aiOpening = '您的膝盖恢复情况如何？有没有感觉好一些？';
    }
    return ResponseHandler.success(res, {
      noteId: randomNote._id.toString(),
      noteTitle: randomNote.title,
      snippet,
      aiOpening
    }, '生成成功(降级)');
  }
}));

export default router;

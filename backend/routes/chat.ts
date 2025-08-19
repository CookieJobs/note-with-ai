// backend/routes/chat.ts
import express from 'express';
import { chatWithDeepSeek, summarizeChatTitle } from '../services/deepseek';
import  Chat  from '../models/Chat';
import { saveChatSession, getChatSessions, deleteChatSession } from '../controllers/chatController';
import { authenticateToken } from '../middleware/auth';
import { findRelatedNotes, findRelatedNotesAdvanced } from '../utils/embedding';

const router = express.Router();

// 保存聊天记录
router.post('/save', authenticateToken, saveChatSession);

// 获取所有聊天记录
router.get('/list', authenticateToken, getChatSessions);

// 删除聊天记录
router.delete('/delete/:sessionId', authenticateToken, deleteChatSession);

// 聊天标题自动摘要接口
router.post('/summarizeTitle', async (req: any, res: any) => {
  const { userContent, aiContent } = req.body;
  if (!userContent || !aiContent) {
    return res.status(400).json({ error: '缺少内容' });
  }
  try {
    // 拼接用户和AI内容作为摘要输入
    const prompt = `用户: ${userContent}\nAI: ${aiContent}`;
    const title = await summarizeChatTitle(prompt);
    res.json({ title });
  } catch (error) {
    console.error('❌ 聊天标题摘要失败:', error);
    res.status(500).json({ error: '生成标题失败' });
  }
});

// 发送给 DeepSeek 聊天接口
router.post('/', authenticateToken, async (req: any, res: any) => {
  const { messages, sessionId, title } = req.body;
  const userId = req.user?.userId;

  console.log('🟢 收到聊天请求:', messages, sessionId, 'userId:', userId);

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不合法' });
  }

  if (!userId) {
    return res.status(401).json({ error: '用户未认证' });
  }

  try {
    // 获取AI回复
    const reply = await chatWithDeepSeek(messages);
    console.log('🤖 DeepSeek 回复:', reply);

    // 保存到数据库（更新会话）
    if (sessionId) {
      await Chat.findByIdAndUpdate(sessionId, { messages }, { new: true });
    } else {
      // 若无sessionId则新建会话
      const session = new Chat({ userId, title: title || '新对话', messages });
      await session.save();
    }

    res.json({ reply });
  } catch (error: any) {
    console.error('❌ 聊天接口错误:', error);
    // 如果是DeepSeek API错误，返回更具体的错误信息
    if (error.message && error.message.includes('DeepSeek API')) {
      res.status(500).json({ error: 'AI服务暂时不可用，请稍后重试' });
    } else {
      res.status(500).json({ error: '聊天失败，请稍后重试' });
    }
  }
});

// 搜索相关笔记接口（异步调用）
router.post('/search-related-notes', authenticateToken, async (req: any, res: any) => {
  const { userMessage, aiReply } = req.body;
  const userId = req.user?.userId;

  console.log('🔍 收到相关笔记搜索请求, userId:', userId);

  if (!userMessage || !aiReply) {
    return res.status(400).json({ error: '缺少用户消息或AI回复' });
  }

  if (!userId) {
    return res.status(401).json({ error: '用户未认证' });
  }

  try {
    console.log('🔍 开始搜索相关笔记...');
    console.log('👤 用户消息:', userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''));
    console.log('🤖 AI回复:', aiReply.substring(0, 100) + (aiReply.length > 100 ? '...' : ''));
    
    // 获取用户的所有笔记
    const { Note } = await import('../models/Note');
    const userNotes = await Note.find({ 
      userId, 
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    });

    if (userNotes.length === 0) {
      console.log('⚠️ 用户没有包含向量的笔记');
      return res.json({ relatedNotes: [] });
    }

    console.log(`📚 用户共有 ${userNotes.length} 条包含向量的笔记`);
    
    // 使用高级搜索方法，分别对用户消息和AI回复进行embedding
    // 降低阈值以获得更宽松的匹配
    const relatedNotesResult = await findRelatedNotesAdvanced(
      userMessage, 
      aiReply, 
      userNotes, 
      {
        maxResults: 3,
        threshold: 0.3, // 从0.7降低到0.3，更宽松的匹配
        dimensions: 1024
      }
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

    res.json({
      relatedNotes: relatedNotes.map(item => ({
        id: item.note._id,
        title: item.note.title,
        content: item.note.content,
        similarity: item.score,
        matchType: item.matchType,
        createdAt: item.note.createdAt
      }))
    });
  } catch (error) {
    console.error('❌ 搜索相关笔记失败:', error);
    res.status(500).json({ error: '搜索相关笔记失败' });
  }
});

export default router;

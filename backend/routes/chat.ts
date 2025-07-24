// backend/routes/chat.ts
import express from 'express';
import { chatWithDeepSeek, summarizeChatTitle } from '../services/deepseek';
import  Chat  from '../models/Chat';
import { saveChatSession, getChatSessions, deleteChatSession } from '../controllers/chatController';

const router = express.Router();

// 保存聊天记录
router.post('/save', saveChatSession);

// 获取所有聊天记录
router.get('/list', getChatSessions);

// 删除聊天记录
router.delete('/delete/:sessionId', deleteChatSession);

// 聊天标题自动摘要接口
router.post('/summarizeTitle', async (req, res) => {
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
router.post('/', async (req, res) => {
  const { messages, sessionId, userId, title } = req.body;

  console.log('🟢 收到聊天请求:', messages, sessionId);

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不合法' });
  }

  try {
    // 先获取AI回复
    const reply = await chatWithDeepSeek(messages);
    console.log('🤖 DeepSeek 回复:', reply);

    // 保存到数据库（更新会话）
    if (sessionId) {
      await Chat.findByIdAndUpdate(sessionId, { messages }, { new: true });
    } else if (userId) {
      // 若无sessionId则新建会话
      const session = new Chat({ userId, title: title || '新对话', messages });
      await session.save();
    }

    res.json({ reply });
  } catch (error) {
    console.error('❌ 聊天接口错误:', error);
    res.status(500).json({ error: '聊天失败' });
  }
});

export default router;

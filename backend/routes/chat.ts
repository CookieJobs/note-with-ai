// backend/routes/chat.ts
import express from 'express';
import { chatWithDeepSeek } from '../services/deepseek';
import  Chat  from '../models/Chat';
import { saveChatSession, getChatSessions } from '../controllers/chatController';

const router = express.Router();

// 保存聊天记录
router.post('/save', saveChatSession);

// 获取所有聊天记录
router.get('/list', getChatSessions);

// 获取所有会话（根据 UUID）
// router.get('/:userId', async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const sessions = await Chat.find({ userId }).sort({ createdAt: -1 });
//     res.json({ sessions });
//   } catch (err) {
//     res.status(500).json({ error: '获取聊天记录失败' });
//   }
// });

// 获取所有会话（聊天记录）
// router.get('/sessions', async (req, res) => {
//   try {
//     const sessions = await Chat.find().sort({ createdAt: -1 });
//     res.json(sessions);
//   } catch (err) {
//     res.status(500).json({ error: '获取聊天记录失败' });
//   }
// });

// 获取某一会话详情
// router.get('/sessions/:id', async (req, res) => {
//   try {
//     const session = await Chat.findById(req.params.id);
//     if (!session) return res.status(404).json({ error: '会话不存在' });
//     res.json(session);
//   } catch (err) {
//     res.status(500).json({ error: '获取会话失败' });
//   }
// });

// 发送给 DeepSeek 聊天接口
router.post('/', async (req, res) => {
  const { messages } = req.body;

  console.log('🟢 收到聊天请求:', messages);

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不合法' });
  }

  try {
    const reply = await chatWithDeepSeek(messages);
    console.log('🤖 DeepSeek 回复:', reply);

    res.json({ reply });
  } catch (error) {
    console.error('❌ 聊天接口错误:', error);
    res.status(500).json({ error: '聊天失败' });
  }
});

// 获取用户历史聊天记录
// router.get('/history/:uuid', async (req, res) => {
//   const { uuid } = req.params;
//   try {
//     const sessions = await Chat.find({ uuid }).sort({ createdAt: -1 }).limit(10);
//     res.status(200).json(sessions);
//   } catch (err: any) {
//     res.status(500).json({ error: '获取聊天记录失败', detail: err.message });
//   }
// });

export default router;

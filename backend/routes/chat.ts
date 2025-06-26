// backend/routes/chat.ts
import express from 'express';
import { chatWithDeepSeek } from '../services/deepseek';
import { ChatSession } from '../models/ChatSession';

const router = express.Router();

// 获取所有会话（聊天记录）
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await ChatSession.find().sort({ createdAt: -1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: '获取聊天记录失败' });
  }
});

// 获取某一会话详情
router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await ChatSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: '会话不存在' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: '获取会话失败' });
  }
});

// 新建或更新对话记录（用于保存用户发送后的记录）
router.post('/save', async (req, res) => {
  const { sessionId, messages, title } = req.body;
  try {
    let session;
    if (sessionId) {
      session = await ChatSession.findByIdAndUpdate(
        sessionId,
        { $set: { messages } },
        { new: true }
      );
    } else {
      session = await new ChatSession({ title: title || messages[0]?.content || '新会话', messages }).save();
    }
    res.json({ sessionId: session._id });
  } catch (err) {
    res.status(500).json({ error: '保存会话失败' });
  }
});

// 保存聊天记录
router.post('/save', async (req, res) => {
  const { sessionId, messages, title } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '无效的聊天消息' });
  }

  try {
    let session;
    if (sessionId) {
      session = await ChatSession.findByIdAndUpdate(sessionId, { messages, title }, { new: true });
    } else {
      session = new ChatSession({ title, messages });
      await session.save();
    }

    res.status(200).json({ session });
  } catch (err: any) {
    console.error('❌ 保存聊天记录失败:', err.message || err);
    res.status(500).json({ error: '保存失败', detail: err.message || err });
  }
});

router.post('/', async (req, res) => {
  const { messages } = req.body;

  console.log('🟢 收到聊天请求:', messages);

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不合法' });
  }

  try {
    const reply = await chatWithDeepSeek(messages); // 直接转发消息给 deepseek
    console.log('🤖 DeepSeek 回复:', reply);

    res.json({ reply }); // 不再附带 relatedNotes
  } catch (error) {
    console.error('❌ 聊天接口错误:', error);
    res.status(500).json({ error: '聊天失败' });
  }
});

export default router;

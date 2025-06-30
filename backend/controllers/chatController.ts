// backend/controllers/chatController.ts
import { Request, Response } from 'express';
import ChatSession from '../models/ChatSession';

export const saveChatSession = async (req: Request, res: Response) => {
  try {
    const { userId, sessionId, title, messages } = req.body;

    let session;

    if (sessionId) {
      // 更新已有对话
      session = await ChatSession.findByIdAndUpdate(
        sessionId,
        { title, messages },
        { new: true }
      );
    } else {
      // 新建对话
      session = new ChatSession({ userId, title, messages });
      await session.save();
    }

    res.json({ success: true, sessionId: session._id });
  } catch (err) {
    console.error('❌ 保存聊天失败:', err);
    res.status(500).json({ success: false, message: '保存失败' });
  }
};

export const getChatSessions = async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, message: '缺少 userId 参数' });
    }

    const sessions = await ChatSession.find({ userId }).sort({ updatedAt: -1 });
    res.json({ success: true, sessions });
  } catch (err) {
    console.error('❌ 获取聊天记录失败:', err);
    res.status(500).json({ success: false, message: '获取失败' });
  }
};

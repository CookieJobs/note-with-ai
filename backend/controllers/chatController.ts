// backend/controllers/chatController.ts
import { Request, Response } from 'express';
import Chat from '../models/Chat';

export const saveChatSession = async (req: Request, res: Response) => {
  try {
    const { userId, sessionId, title, messages } = req.body;

    let session;

    if (sessionId) {
      // 更新已有对话
      session = await Chat.findByIdAndUpdate(
        sessionId,
        { title, messages },
        { new: true }
      );
    } else {
      // 新建对话
      session = new Chat({ userId, title, messages });
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

    const sessions = await Chat.find({ userId }).sort({ updatedAt: -1 }).lean();
    
    // 映射 _id 为 id，避免前端处理混乱
    const formatted = sessions.map((s) => ({
      ...s,
      id: s._id.toString(), // 转换为字符串
      _id: undefined,       // 可选：移除 _id 字段
    }));
    
    res.json({ success: true, sessions });
  } catch (err) {
    console.error('❌ 获取聊天记录失败:', err);
    res.status(500).json({ success: false, message: '获取失败' });
  }
};

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
      _id: s._id.toString(), // 保持 _id 字段但转为字符串
    }));
    
    res.json({ success: true, sessions: formatted });
  } catch (err) {
    console.error('❌ 获取聊天记录失败:', err);
    res.status(500).json({ success: false, message: '获取失败' });
  }
};

// 删除聊天记录
export const deleteChatSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { userId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: '缺少 sessionId 参数' });
    }

    // 确保只能删除自己的聊天记录
    const session = await Chat.findOne({ _id: sessionId });
    if (!session) {
      return res.status(404).json({ success: false, message: '聊天记录不存在' });
    }

    if (session.userId !== userId) {
      return res.status(403).json({ success: false, message: '无权删除此聊天记录' });
    }

    await Chat.findByIdAndDelete(sessionId);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('❌ 删除聊天记录失败:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
};

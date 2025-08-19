// backend/controllers/chatController.ts
import { Request, Response } from 'express';
import Chat from '../models/Chat';

export const saveChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' });
      return;
    }

    const { sessionId, title, messages } = req.body;
    const userId = req.user.userId;

    let session;

    if (sessionId) {
      // 更新已有对话（确保只能更新自己的对话）
      session = await Chat.findOneAndUpdate(
        { _id: sessionId, userId },
        { title, messages },
        { new: true }
      );
      if (!session) {
        res.status(404).json({ success: false, message: '对话不存在或无权限' });
        return;
      }
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

export const getChatSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' });
      return;
    }

    const userId = req.user.userId;
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
export const deleteChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' });
      return;
    }

    const { sessionId } = req.params;
    const userId = req.user.userId;

    if (!sessionId) {
      res.status(400).json({ success: false, message: '缺少 sessionId 参数' });
      return;
    }

    // 确保只能删除自己的聊天记录
    const session = await Chat.findOne({ _id: sessionId, userId });
    if (!session) {
      res.status(404).json({ success: false, message: '聊天记录不存在或无权限删除' });
      return;
    }

    await Chat.findByIdAndDelete(sessionId);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('❌ 删除聊天记录失败:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
};

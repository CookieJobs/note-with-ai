// backend/controllers/chatController.ts
import { Request, Response } from 'express';
import Chat from '../models/Chat';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import { ResponseHandler, ErrorHandler } from '../utils/errorHandler';

export const saveChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserValidator.authenticateUser(req);
    const { sessionId, title, messages } = req.body;
    const userId = user._id.toString();

    let session;

    if (sessionId) {
      // 更新已有对话（确保只能更新自己的对话）
      await ResourceValidator.validateOwnership(Chat, sessionId, userId, '对话');
      session = await Chat.findOneAndUpdate(
        { _id: sessionId, userId },
        { title, messages },
        { new: true }
      );
      if (!session) {
        throw ErrorHandler.createNotFoundError('对话不存在');
      }
    } else {
      // 新建对话
      session = new Chat({ userId, title, messages });
      await session.save();
    }

    ResponseHandler.success(res, { sessionId: session._id });
  } catch (err) {
    console.error('❌ 保存聊天失败:', err);
    throw ErrorHandler.createInternalError('保存失败');
  }
};

export const getChatSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserValidator.authenticateUser(req);
    const userId = user._id.toString();
    const sessions = await Chat.find({ userId }).sort({ updatedAt: -1 }).lean();
    
    // 映射 _id 为 id，避免前端处理混乱
    const formatted = sessions.map((s) => ({
      ...s,
      id: s._id.toString(), // 转换为字符串
      _id: s._id.toString(), // 保持 _id 字段但转为字符串
    }));
    
    ResponseHandler.success(res, { sessions: formatted });
  } catch (err) {
    console.error('❌ 获取聊天记录失败:', err);
    throw ErrorHandler.createInternalError('获取失败');
  }
};

// 删除聊天记录
export const deleteChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserValidator.authenticateUser(req);
    const { sessionId } = req.params;
    const userId = user._id.toString();

    if (!sessionId) {
      throw ErrorHandler.createValidationError('缺少 sessionId 参数');
    }

    // 确保只能删除自己的聊天记录
    await ResourceValidator.validateOwnership(Chat, sessionId, userId, '聊天记录');

    await Chat.findByIdAndDelete(sessionId);
    ResponseHandler.success(res, {}, '删除成功');
  } catch (err) {
    console.error('❌ 删除聊天记录失败:', err);
    throw ErrorHandler.createInternalError('删除失败');
  }
};

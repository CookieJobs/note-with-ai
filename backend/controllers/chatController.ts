import { Request, Response } from 'express';
import { chatService } from '../services/chatService';
import { chatTurnCommitService } from '../services/chatTurnCommitService';
import { ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { logger } from '../utils/logger';
import { requireSingleRouteParam } from '../utils/requestParams';

export const saveChatSession = async (req: Request, res: Response): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const { sessionId, title, messages, relatedNotes } = req.body;
  const userId = user._id.toString();

  const session = await chatService.saveSession(userId, sessionId, messages, title, relatedNotes);
  const savedSessionId = (session as any)._id?.toString?.() || (session as any).id;

  ResponseHandler.success(res, { sessionId: savedSessionId });
};

export const getChatSessions = async (req: Request, res: Response): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const userId = user._id.toString();
  
  const sessions = await chatService.getSessions(userId);

  const formatted = sessions.map((s) => ({
    ...s,
    id: s._id.toString(),
    _id: s._id.toString(),
  }));
  const sessionsWithNotes = formatted.filter(s => s.relatedNotes && s.relatedNotes.length > 0).length;
  logger.info(`🔍 getChatSessions: 返回 ${formatted.length} 条会话，其中 ${sessionsWithNotes} 条包含相关笔记`);
  
  ResponseHandler.success(res, { sessions: formatted });
};

export const deleteChatSession = async (req: Request, res: Response): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const sessionId = requireSingleRouteParam(req.params.sessionId, 'sessionId');
  const userId = user._id.toString();

  await chatService.deleteSession(userId, sessionId);
  ResponseHandler.success(res, {}, '删除成功');
};

export const streamChat = async (req: Request, res: Response): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const userId = user._id.toString();

  const { messages, sessionId, title } = req.body;
  logger.info('🟢 收到聊天请求 (流式):', messages?.length, '条消息, sessionId:', sessionId, 'userId:', userId);

  let clientClosed = false;

  const isWritable = () =>
    !clientClosed && !res.writableEnded && !res.destroyed && (res as any).writable !== false;

  const safeWrite = (data: string) => {
    if (!isWritable()) return false;
    try {
      return res.write(data);
    } catch {
      clientClosed = true;
      return false;
    }
  };

  req.once('close', () => {
    clientClosed = true;
  });

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const { session } = await chatTurnCommitService.streamAndCommit({
      userId,
      messages,
      sessionId,
      title,
      onChunk: (chunk) => {
        if (!isWritable()) return false;
        safeWrite(`data: ${JSON.stringify({ chunk })}\n\n`);
        return true;
      },
    });

    if (!clientClosed && isWritable()) {
      const formattedSession = {
        ...session,
        id: session._id.toString(),
        _id: session._id.toString(),
      };
      safeWrite(`data: ${JSON.stringify({ type: 'committed', session: formattedSession })}\n\n`);
    }

    if (isWritable()) {
      safeWrite('data: [DONE]\n\n');
      res.end();
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'CHAT_STREAM_ABORTED') {
      if (isWritable()) {
        res.end();
      }
      return;
    }

    logger.error('❌ 聊天接口流式错误:', error);

    if (!res.headersSent) {
      if (error instanceof Error && (error as any).statusCode) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('API请求错误')) {
        throw ErrorHandler.createExternalApiError('AI服务暂时不可用，请稍后重试', 'DeepSeek');
      }
      throw ErrorHandler.createInternalError('聊天失败，请稍后重试');
    }

    if (isWritable()) {
      safeWrite(`data: ${JSON.stringify({ error: 'AI 服务暂时不可用，请稍后重试' })}\n\n`);
      res.end();
    }
  }
};

export const summarizeTitle = async (req: Request, res: Response): Promise<void> => {
  // 兼容保留：聊天主链路已改由后端提交器内部生成标题，不再由前端流式发送后单独调用。
  await UserValidator.authenticateUser(req);

  const { userContent, aiContent } = req.body;
  const title = await chatService.summarizeTitle(userContent, aiContent);
  ResponseHandler.success(res, { title }, '生成标题成功');
};

export const generateIntro = async (req: Request, res: Response): Promise<void> => {
    const user = await UserValidator.authenticateUser(req);
    const userId = user._id.toString();

    const result = await chatService.generateIntro(userId);
    // Determine message based on result (downgrade or not)
    // The service doesn't return the message, so we can use a generic one or infer.
    // Actually the service returns the full object.
    ResponseHandler.success(res, result, '生成成功');
};

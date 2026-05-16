import { Request, Response } from 'express';
import { chatService } from '../services/chatService';
import { ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';
import { logger } from '../utils/logger';

export const saveChatSession = async (req: Request, res: Response): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const { sessionId, title, messages, relatedNotes } = req.body;
  const userId = user._id.toString();

  const session = await chatService.saveSession(userId, sessionId, messages, title, relatedNotes);

  ResponseHandler.success(res, { sessionId: session._id });
};

export const getChatSessions = async (req: Request, res: Response): Promise<void> => {
  const user = await UserValidator.authenticateUser(req);
  const userId = user._id.toString();
  
  const sessions = await chatService.getSessions(userId);
  
  // Format sessions for frontend
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
  const { sessionId } = req.params;
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
  let stream: AsyncIterable<string> | undefined;

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

  const stopStream = async (s: unknown) => {
    try {
      if (s && typeof (s as AsyncGenerator).return === 'function') {
        await (s as AsyncGenerator).return('');
      }
    } catch {}
  };

  req.once('close', () => {
    clientClosed = true;
  });

  try {
    stream = await chatService.streamChat(messages);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let fullReply = '';
    for await (const chunk of stream) {
      if (!isWritable()) {
        await stopStream(stream);
        break;
      }
      fullReply += chunk;
      safeWrite(`data: ${JSON.stringify({ chunk })}\n\n`);
    }

    if (!clientClosed) {
      logger.info('🤖 DeepSeek 回复完成，开始保存到数据库...');
      const finalMessages = [...messages, { role: 'assistant', content: fullReply }];
      try {
        const savedSession = await chatService.saveSession(userId, sessionId, finalMessages, title);
        const savedSessionId = (savedSession._id || (savedSession as any).id)?.toString();
        if (savedSessionId && isWritable()) {
          safeWrite(`data: ${JSON.stringify({ type: 'meta', sessionId: savedSessionId })}\n\n`);
        }
      } catch (saveError) {
        logger.error('❌ 保存会话失败 (流式响应后):', saveError);
        if (isWritable()) {
          safeWrite(`data: ${JSON.stringify({ error: '会话保存失败，请稍后重试' })}\n\n`);
          res.end();
        }
        return;
      }
    }

    if (isWritable()) {
      safeWrite('data: [DONE]\n\n');
      res.end();
    }
  } catch (error: unknown) {
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

    await stopStream(stream);

    if (isWritable()) {
      safeWrite(`data: ${JSON.stringify({ error: 'AI 服务暂时不可用，请稍后重试' })}\n\n`);
      res.end();
    }
  }
};

export const summarizeTitle = async (req: Request, res: Response): Promise<void> => {
    // Note: The original route didn't strictly require auth for this helper? 
    // Yes it did: router.post('/summarizeTitle', authenticateToken, ...)
    // So we don't strictly need user ID for the logic, but we need to authenticate.
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

export const searchRelatedNotes = async (req: Request, res: Response): Promise<void> => {
    const user = await UserValidator.authenticateUser(req);
    const userId = user._id.toString();
    const { userMessage, aiReply } = req.body;

    if (!userMessage || !aiReply) {
        throw ErrorHandler.createValidationError('缺少用户消息或AI回复');
    }

    const relatedNotes = await chatService.searchRelatedNotes(userId, userMessage, aiReply);
    ResponseHandler.success(res, { relatedNotes }, '搜索相关笔记成功');
};

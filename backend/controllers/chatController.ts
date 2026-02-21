import { Request, Response } from 'express';
import { chatService } from '../services/chatService';
import { ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';

export const saveChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserValidator.authenticateUser(req);
    const { sessionId, title, messages, relatedNotes } = req.body;
    const userId = user._id.toString();

    const session = await chatService.saveSession(userId, sessionId, messages, title, relatedNotes);

    ResponseHandler.success(res, { sessionId: session._id });
  } catch (err) {
    console.error('❌ 保存聊天失败:', err);
    if (err instanceof Error && (err as any).statusCode) {
      throw err;
    }
    throw ErrorHandler.createInternalError('保存失败');
  }
};

export const getChatSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserValidator.authenticateUser(req);
    const userId = user._id.toString();
    
    const sessions = await chatService.getSessions(userId);
    
    // Format sessions for frontend
    const formatted = sessions.map((s: any) => ({
      ...s,
      id: s._id.toString(),
      _id: s._id.toString(),
    }));

    const sessionsWithNotes = formatted.filter(s => s.relatedNotes && s.relatedNotes.length > 0).length;
    console.log(`🔍 getChatSessions: 返回 ${formatted.length} 条会话，其中 ${sessionsWithNotes} 条包含相关笔记`);
    
    ResponseHandler.success(res, { sessions: formatted });
  } catch (err) {
    console.error('❌ 获取聊天记录失败:', err);
    throw ErrorHandler.createInternalError('获取失败');
  }
};

export const deleteChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserValidator.authenticateUser(req);
    const { sessionId } = req.params;
    const userId = user._id.toString();

    if (!sessionId) {
      throw ErrorHandler.createValidationError('缺少 sessionId 参数');
    }

    await chatService.deleteSession(userId, sessionId);
    ResponseHandler.success(res, {}, '删除成功');
  } catch (err) {
    console.error('❌ 删除聊天记录失败:', err);
    if (err instanceof Error && (err as any).statusCode) {
      throw err;
    }
    throw ErrorHandler.createInternalError('删除失败');
  }
};

export const streamChat = async (req: Request, res: Response): Promise<void> => {
  // We need to handle authentication manually here if not using middleware, 
  // but typically routes use middleware. 
  // However, since we are moving logic from routes/chat.ts which used middleware,
  // we can assume req.user is populated OR use UserValidator.
  // Let's use UserValidator to be safe and consistent with other controller methods.
  
  let userId: string;
  try {
    const user = await UserValidator.authenticateUser(req);
    userId = user._id.toString();
  } catch (err) {
    // If validation fails, we should return 401
    // But since this is a stream, we might need to handle it differently if headers are sent?
    // No, headers are not sent yet.
    throw err;
  }

  const { messages, sessionId, title } = req.body;
  console.log('🟢 收到聊天请求 (流式):', messages?.length, '条消息, sessionId:', sessionId, 'userId:', userId);

  try {
    const stream = await chatService.streamChat(messages);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let fullReply = '';
    for await (const chunk of stream) {
      fullReply += chunk;
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

    console.log('🤖 DeepSeek 回复完成，开始保存到数据库...');
    const finalMessages = [...messages, { role: 'assistant', content: fullReply }];
    
    // Save to DB in background (awaiting it here to ensure it completes, but response is already sent)
    try {
        await chatService.saveSession(userId, sessionId, finalMessages, title);
    } catch (saveError) {
        console.error('❌ 保存会话失败 (流式响应后):', saveError);
        // We cannot send error to client as stream is closed.
    }

  } catch (error: any) {
    console.error('❌ 聊天接口流式错误:', error);
    if (!res.headersSent) {
      if (error.message && error.message.includes('API请求错误')) {
        throw ErrorHandler.createExternalApiError('AI服务暂时不可用，请稍后重试', 'DeepSeek');
      } else {
        throw ErrorHandler.createInternalError('聊天失败，请稍后重试');
      }
    } else {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'AI 服务暂时不可用，请稍后重试' })}\n\n`);
        res.end();
      }
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

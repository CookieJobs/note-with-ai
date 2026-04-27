import { z } from 'zod';

export const saveSessionSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, '缺少 sessionId 参数'),
    title: z.string().optional(),
    messages: z.array(z.any()).min(1, '消息列表不能为空'),
    relatedNotes: z.array(z.string()).optional(),
  }),
});

export const deleteSessionSchema = z.object({
  params: z.object({
    sessionId: z.string().min(1, '缺少 sessionId 参数'),
  }),
});

export const streamChatSchema = z.object({
  body: z.object({
    sessionId: z.string().optional(),
    title: z.string().optional(),
    messages: z.array(z.any()).min(1, '消息列表不能为空'),
  }),
});

export const summarizeTitleSchema = z.object({
  body: z.object({
    userContent: z.string().min(1, '用户内容不能为空'),
    aiContent: z.string().min(1, 'AI内容不能为空'),
  }),
});

export const searchRelatedNotesSchema = z.object({
  body: z.object({
    userMessage: z.string().min(1, '用户消息不能为空'),
    aiReply: z.string().min(1, 'AI回复不能为空'),
  }),
});

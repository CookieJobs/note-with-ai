import { z } from 'zod';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const relatedNoteObjectSchema = z.object({
  noteId: z.string().min(1, '缺少笔记 ID'),
  id: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  score: z.number().optional(),
  similarity: z.number().optional(),
  matchType: z.string().optional(),
  reason: z.string().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
});

const relatedNoteSchema = z.union([z.string().min(1, '缺少笔记 ID'), relatedNoteObjectSchema]);

export const saveSessionSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, '缺少 sessionId 参数').optional(),
    title: z.string().optional(),
    messages: z.array(messageSchema),
    relatedNotes: z.array(relatedNoteSchema).optional(),
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
    messages: z.array(messageSchema).min(1, '消息列表不能为空'),
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

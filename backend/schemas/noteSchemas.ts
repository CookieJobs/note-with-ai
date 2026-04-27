import { z } from 'zod';

export const createNoteSchema = z.object({
  body: z.object({
    content: z.string().optional(),
    contentJson: z.any().optional(),
    contentText: z.string().optional(),
  }).refine(data => data.content || data.contentText, {
    message: '内容不能为空',
    path: ['content']
  })
});

export const updateTitleSchema = z.object({
  body: z.object({
    title: z.string().min(1, '标题不能为空'),
  }),
  params: z.object({
    id: z.string().min(1, '缺少笔记ID'),
  })
});

export const chatNoteSchema = z.object({
  body: z.object({
    messages: z.array(z.any()).min(1, '消息内容无效'),
  })
});

export const ensureSchema = z.object({
  body: z.object({
    limit: z.number().min(1).max(50).optional(),
  }).optional()
});

export const updateNoteSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    content: z.string().optional(),
    contentJson: z.any().optional(),
    contentText: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    updatedAt: z.string().or(z.date()).optional(),
    autoSummarize: z.boolean().optional(),
    summaryCheck: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().min(1, '缺少笔记ID'),
  })
});

export const noteIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, '缺少笔记ID'),
  })
});

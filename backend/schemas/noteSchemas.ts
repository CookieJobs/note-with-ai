import { z } from 'zod';

const richTextBodySchema = z.object({
  kind: z.literal('rich-text'),
  document: z.unknown().refine(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    { message: 'NOTE_BODY_INVALID' },
  ),
  fallbackMarkdown: z.unknown().optional().refine(
    (value) => value === undefined || typeof value === 'string',
    { message: 'NOTE_BODY_INVALID' },
  ),
});

const plainTextBodySchema = z.object({
  kind: z.literal('plain-text'),
  text: z.unknown().refine((value) => typeof value === 'string', { message: 'NOTE_BODY_INVALID' }),
});

const noteBodySchema = z.discriminatedUnion('kind', [richTextBodySchema, plainTextBodySchema]);

const changesSchema = z.object({
  body: noteBodySchema.optional(),
  title: z.string().optional(),
  keywords: z.array(z.string()).optional(),
}).refine((changes) => changes.body !== undefined || changes.title !== undefined || changes.keywords !== undefined, {
  message: '笔记更新不能为空',
});

const legacyCreateSchema = z.object({
  content: z.string().optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  contentText: z.string().optional(),
}).refine((data) => data.content !== undefined || data.contentText !== undefined || data.contentJson !== undefined, {
  message: '内容不能为空',
});

const legacyUpdateSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  contentText: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  updatedAt: z.string().or(z.date()).optional(),
  autoSummarize: z.boolean().optional(),
  summaryCheck: z.boolean().optional(),
}).refine((data) =>
  data.title !== undefined
  || data.content !== undefined
  || data.contentJson !== undefined
  || data.contentText !== undefined
  || data.keywords !== undefined
  || data.autoSummarize !== undefined
  || data.summaryCheck !== undefined,
{ message: '笔记更新不能为空' });

export const createNoteSchema = z.object({
  body: z.union([
    z.object({ body: noteBodySchema }),
    legacyCreateSchema,
  ]),
});

export const updateTitleSchema = z.object({
  body: z.object({
    title: z.string().min(1, '标题不能为空'),
  }),
  params: z.object({
    id: z.string().min(1, '缺少笔记ID'),
  }),
});

export const chatNoteSchema = z.object({
  body: z.object({
    messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1, '消息内容无效'),
  }),
});

export const ensureSchema = z.object({
  body: z.object({
    limit: z.number().min(1).max(50).optional(),
  }).optional(),
});

export const updateNoteSchema = z.object({
  body: z.union([
    z.object({
      expectedRevision: z.number().int().positive(),
      changes: changesSchema,
    }),
    legacyUpdateSchema,
  ]),
  params: z.object({
    id: z.string().min(1, '缺少笔记ID'),
  }),
});

export const noteIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, '缺少笔记ID'),
  }),
});

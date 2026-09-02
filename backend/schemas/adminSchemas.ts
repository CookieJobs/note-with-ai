import { z } from 'zod';

export const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1).max(1024),
    otp: z.string().regex(/^\d{6}$/),
  }),
});

const boundedPage = z.coerce.number().int().min(1).default(1);
const boundedLimit = z.coerce.number().int().min(1).max(100).default(20);
export const adminUserListSchema = z.object({
  query: z.string().max(100).optional(), status: z.enum(['active', 'disabled']).optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(), page: boundedPage, limit: boundedLimit,
});
export const adminUserStatusSchema = z.object({ body: z.object({ isActive: z.boolean(), reason: z.string().trim().min(5).max(200) }) });
export const adminAuditListSchema = z.object({
  actorId: z.string().optional(), action: z.string().max(100).optional(), status: z.enum(['pending', 'succeeded', 'failed']).optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(), page: boundedPage, limit: boundedLimit,
});

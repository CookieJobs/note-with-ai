import { z } from 'zod';

export const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1).max(1024),
    otp: z.string().regex(/^\d{6}$/),
  }),
});

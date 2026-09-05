import { z } from 'zod';

export const correctionSchema = z.object({
  body: z.object({ correction: z.string().trim().min(1).max(500) }),
  params: z.object({ id: z.string().min(1) }),
});
export const memoryIdSchema = z.object({ params: z.object({ id: z.string().min(1) }) });
export const notePreferenceParamSchema = z.object({ params: z.object({ noteId: z.string().min(1) }) });
export const notePreferenceSchema = z.object({
  params: z.object({ noteId: z.string().min(1) }),
  body: z.object({ included: z.boolean() }),
});


import { z } from 'zod';
export const createPublicationSchema = z.object({ body: z.object({ noteId: z.string().min(1) }) });
export const publicationIdSchema = z.object({ params: z.object({ id: z.string().min(1) }) });
export const publicSlugSchema = z.object({ params: z.object({ slug: z.string().min(20).max(128) }) });


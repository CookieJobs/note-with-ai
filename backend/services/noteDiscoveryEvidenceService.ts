import { z } from 'zod';
import { isObjectIdOrHexString } from 'mongoose';
import type { EvidenceDto, EvidenceInput } from '../types/noteDiscovery';
import { loadChatNoteSource } from './chatNoteContextService';

export const discoveryEvidenceInputSchema = z.strictObject({
  noteId: z.string().regex(/^[a-f\d]{24}$/i),
  revision: z.number().int().positive().safe(),
  excerpt: z.string().min(1).max(12000).refine(value => value.trim().length > 0),
});
export type ValidatedEvidence = EvidenceDto & { locator: { start: number; end: number } };
export type DiscoverySource = Awaited<ReturnType<typeof loadChatNoteSource>>;
export type DiscoverySourceErrorCode = 'unavailable' | 'too_large' | 'unreadable' | 'read_failed' | 'invalid_evidence' | 'stale_revision' | 'excerpt_mismatch';

export class DiscoverySourceError extends Error {
  constructor(public readonly code: DiscoverySourceErrorCode) {
    super(code);
    this.name = 'DiscoverySourceError';
  }
}

/** Canonical chat normalization removes image URLs/alt text and never truncates a full source. */
export async function readDiscoverySource(userId: string, noteId: string): Promise<DiscoverySource> {
  if (!isObjectIdOrHexString(userId) || !isObjectIdOrHexString(noteId)) throw new DiscoverySourceError('unavailable');
  try {
    return await loadChatNoteSource(userId, noteId);
  } catch (error) {
    const code = (error as { details?: { code?: string } }).details?.code;
    if (code === 'CHAT_SOURCE_TOO_LONG') throw new DiscoverySourceError('too_large');
    if (code === 'CHAT_SOURCE_UNAVAILABLE') throw new DiscoverySourceError('unavailable');
    if (code === 'CHAT_SOURCE_EMPTY' || code === 'CHAT_SOURCE_IMAGES_ONLY') throw new DiscoverySourceError('unreadable');
    throw new DiscoverySourceError('read_failed');
  }
}

/** All evidence is re-read by authenticated owner; caller-provided snapshots are never trusted. */
export async function validateEvidence(userId: string, evidence: EvidenceInput[]): Promise<ValidatedEvidence[]> {
  const parsed = z.array(discoveryEvidenceInputSchema).min(1).max(12).safeParse(evidence);
  if (!parsed.success || !isObjectIdOrHexString(userId)) throw new DiscoverySourceError('invalid_evidence');
  const sources = new Map<string, DiscoverySource>();
  const result: ValidatedEvidence[] = [];
  for (const item of parsed.data) {
    const key = item.noteId.toLowerCase();
    let source = sources.get(key);
    if (!source) {
      source = await readDiscoverySource(userId, key);
      sources.set(key, source);
    }
    if (source.revision !== item.revision) throw new DiscoverySourceError('stale_revision');
    // An unread image marker alone can never substantiate a factual claim.
    if (!item.excerpt.replace(/\[(?:图片|image)\]/giu, '').trim()) throw new DiscoverySourceError('excerpt_mismatch');
    const start = source.contentText.indexOf(item.excerpt);
    if (start < 0) throw new DiscoverySourceError('excerpt_mismatch');
    result.push({
      noteId: source.noteId, revision: source.revision, excerpt: item.excerpt,
      title: source.title ?? '', noteDate: source.updatedAt, hasImages: source.hasImages,
      locator: { start, end: start + item.excerpt.length },
    });
  }
  return result;
}

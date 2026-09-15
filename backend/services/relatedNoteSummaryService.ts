import { Note } from '../models/Note';
import { ErrorHandler } from '../utils/errorHandler';

export type RelatedNoteSummary = {
  id: string;
  title: string;
  contentText: string;
  createdAt: string;
  type: string;
  reason: string;
  scoreBand: 'possible' | 'supported';
};

export type RelatedNoteSummaryResult = {
  sourceRevision: number;
  relationships: RelatedNoteSummary[];
};

const MAX_RELATIONSHIPS = 5;
// Keep room for deleted or otherwise inaccessible cached notes while bounding
// the Mongo $in query to a small, predictable size.
const MAX_CACHED_CANDIDATES = MAX_RELATIONSHIPS * 4;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_TEXT_LENGTH = 2000;
const MAX_TYPE_LENGTH = 80;
const MAX_REASON_LENGTH = 500;
const FINAL_SCORE_S1_WEIGHT = 0.3;
const FINAL_SCORE_S2_WEIGHT = 0.7;

type RankedCachedCandidate = {
  id: string;
  cached: Record<string, unknown>;
  score: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function finiteNumber(value: unknown): number | null {
  try {
    const score = Number(value);
    return Number.isFinite(score) ? score : null;
  } catch {
    return null;
  }
}

function boundedScore(value: unknown): number {
  const score = finiteNumber(value);
  return score === null ? 0 : Math.max(0, Math.min(1, score));
}

function cachedCandidateScore(candidate: Record<string, unknown>): number {
  const explicitScore = candidate.score;
  if (explicitScore !== undefined && explicitScore !== null && explicitScore !== '') {
    if (finiteNumber(explicitScore) !== null) return boundedScore(explicitScore);
  }

  // Keep the same final-score contract as recommendService while tolerating
  // legacy or damaged cache entries that omit or corrupt either component.
  return FINAL_SCORE_S1_WEIGHT * boundedScore(candidate.s1)
    + FINAL_SCORE_S2_WEIGHT * boundedScore(candidate.s2);
}

function compareRankedCandidates(a: RankedCachedCandidate, b: RankedCachedCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  // Object property order is not a reliable ranking contract (especially for
  // numeric-looking ids), so use a stable, locale-independent tie-breaker.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function selectRankedCachedCandidates(byCandidateId: Record<string, unknown>): RankedCachedCandidate[] {
  const selected: RankedCachedCandidate[] = [];

  // Keep this bounded while traversing. A malformed cache must never turn into
  // an unbounded candidate-id array or an oversized Mongo $in query.
  for (const id in byCandidateId) {
    if (!Object.prototype.hasOwnProperty.call(byCandidateId, id) || !id) continue;
    const cached = byCandidateId[id];
    if (!isRecord(cached)) continue;

    selected.push({ id, cached, score: cachedCandidateScore(cached) });
    selected.sort(compareRankedCandidates);
    if (selected.length > MAX_CACHED_CANDIDATES) selected.pop();
  }

  return selected;
}

function toIsoDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function scoreBand(candidate: Record<string, unknown>): RelatedNoteSummary['scoreBand'] {
  // The cached reranker score is intentionally reduced to a qualitative band.
  // A weak relationship is never represented as supported, even if legacy cache
  // data contains an unexpectedly high numeric score.
  const rerankerScore = finiteNumber(candidate.s2);
  return candidate.type !== '弱关联' && rerankerScore !== null && rerankerScore >= 0.7
    ? 'supported'
    : 'possible';
}

export async function getRelatedNoteSummaryResult(params: {
  userId: string;
  noteId: string;
}): Promise<RelatedNoteSummaryResult> {
  const source = await Note.findOne({ _id: params.noteId, userId: params.userId }).lean();
  if (!source) {
    throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
  }

  const sourceRevision = Number(source.revision);
  const cache = isRecord(source.recommendCache) ? source.recommendCache : null;
  const cacheRevision = Number(cache?.sourceRevision);
  const byCandidateId = isRecord(cache?.byCandidateId) ? cache.byCandidateId : null;

  // Caches are only meaningful for the exact source revision that created them.
  // Do not reveal stale candidate content while enrichment is being refreshed.
  if (!Number.isInteger(sourceRevision) || sourceRevision <= 0 || cacheRevision !== sourceRevision || !byCandidateId) {
    return { sourceRevision: Number.isInteger(sourceRevision) && sourceRevision > 0 ? sourceRevision : 1, relationships: [] };
  }

  const rankedCandidates = selectRankedCachedCandidates(byCandidateId);
  if (rankedCandidates.length === 0) {
    return { sourceRevision, relationships: [] };
  }

  const candidateIds = rankedCandidates.map(({ id }) => id);
  const candidates = await Note.find({ _id: { $in: candidateIds }, userId: params.userId })
    .select('_id title contentText createdAt')
    .lean();
  const candidatesById = new Map(candidates.map((candidate) => [String(candidate._id), candidate]));

  const relationships = rankedCandidates
    .map(({ id, cached }) => {
      const candidate = candidatesById.get(id);
      if (!candidate) return null;
      return {
        id,
        title: text(candidate.title, MAX_TITLE_LENGTH),
        contentText: text(candidate.contentText, MAX_CONTENT_TEXT_LENGTH),
        createdAt: toIsoDate(candidate.createdAt),
        type: text(cached.type, MAX_TYPE_LENGTH),
        reason: text(cached.reason, MAX_REASON_LENGTH),
        scoreBand: scoreBand(cached),
      } satisfies RelatedNoteSummary;
    })
    .filter((relationship): relationship is RelatedNoteSummary => relationship !== null)
    .slice(0, MAX_RELATIONSHIPS);

  return { sourceRevision, relationships };
}

export async function getRelatedNoteSummaries(params: {
  userId: string;
  noteId: string;
}): Promise<RelatedNoteSummary[]> {
  return (await getRelatedNoteSummaryResult(params)).relationships;
}

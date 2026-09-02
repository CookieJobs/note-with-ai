import type { IRecommendCache, IRecommendCacheCandidate } from '../../../types';
import type { NoteRelationship } from '../types/relationships';

export type RelationshipRecommendCache = IRecommendCache & {
  status?: 'insufficient_history' | 'enriching' | 'ready' | 'failed';
  relationships?: NoteRelationship[];
};

type RecommendCacheLikeNote = {
  updatedAt?: string;
  revision?: number;
  recommendCache?: IRecommendCache | null;
};

export type RecommendCacheStatus =
  | 'missing'
  | 'current-empty'
  | 'stale'
  | 'ready';

export type RecommendCacheState = {
  status: RecommendCacheStatus;
  needsRefresh: boolean;
  hasDisplayableEntries: boolean;
  hasEntries: boolean;
  hasCurrentVersion: boolean;
  hasS1Data: boolean;
};

function normalizeEntries(
  cache: IRecommendCache | null | undefined
): Array<[string, IRecommendCacheCandidate]> {
  const byCandidateId = cache?.byCandidateId;
  if (!byCandidateId || typeof byCandidateId !== 'object') return [];
  return Object.entries(byCandidateId);
}

export function hasCandidateS1(candidate: IRecommendCacheCandidate | null | undefined): boolean {
  if (!candidate) return false;
  return Number.isFinite(Number(candidate.s1));
}

export function buildRecommendCacheFromResponse(
  note: Pick<RecommendCacheLikeNote, 'updatedAt' | 'revision'>,
  payload: any
): RelationshipRecommendCache {
  const data = payload?.data ?? {};
  const meta = data?.meta ?? {};
  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];
  const relationships = Array.isArray(data?.relationships) ? data.relationships as NoteRelationship[] : [];
  const generatedAt = new Date().toISOString();
  const byCandidateId: NonNullable<IRecommendCache['byCandidateId']> = recommendations.reduce(
    (acc: NonNullable<IRecommendCache['byCandidateId']>, item: any) => {
      const candidateId = String(item?.note?._id || '');
      if (!candidateId) return acc;
      acc[candidateId] = {
        s1: Number.isFinite(Number(item?.s1)) ? Number(item.s1) : undefined,
        s2: Number(item?.s2 || 0),
        type: typeof item?.type === 'string' ? item.type : '',
        reason: typeof item?.reason === 'string' ? item.reason : '',
        candidateUpdatedAt: String(item?.note?.updatedAt || ''),
        cachedAt: generatedAt,
      };
      return acc;
    },
    {}
  );

  return {
    algoVersion: typeof meta?.algoVersion === 'string' ? meta.algoVersion : 'semantic-notes-v3',
    sourceUpdatedAt: note.updatedAt,
    sourceRevision: note.revision,
    generatedAt,
    params: meta?.thresholds,
    diagnostics: meta?.diagnostics,
    byCandidateId,
    status: data?.status,
    relationships,
  };
}

export function getRecommendCacheState(note: RecommendCacheLikeNote | null | undefined): RecommendCacheState {
  const cache = note?.recommendCache as RelationshipRecommendCache | null | undefined ?? null;
  const entries = normalizeEntries(cache);
  const hasEntries = entries.length > 0;
  const hasRelationships = Array.isArray(cache?.relationships) && cache.relationships.length > 0;
  const hasCacheRevision = cache?.sourceRevision !== undefined && cache?.sourceRevision !== null;
  const hasCurrentVersion = !!cache && (hasCacheRevision
    ? Number(cache.sourceRevision) === Number(note?.revision)
    : !!note?.updatedAt && String(cache.sourceUpdatedAt || '') === String(note.updatedAt || ''));
  const hasS1Data = hasEntries && entries.every(([, candidate]) => hasCandidateS1(candidate));

  if (!cache) {
    return {
      status: 'missing',
      needsRefresh: true,
      hasDisplayableEntries: false,
      hasEntries: false,
      hasCurrentVersion: false,
      hasS1Data: false,
    };
  }

  if (hasCurrentVersion && !hasEntries && !hasRelationships) {
    return {
      status: 'current-empty',
      needsRefresh: false,
      hasDisplayableEntries: false,
      hasEntries: false,
      hasCurrentVersion: true,
      hasS1Data: false,
    };
  }

  if (hasCurrentVersion && (hasEntries || hasRelationships)) {
    return {
      status: 'ready',
      needsRefresh: false,
      hasDisplayableEntries: true,
      hasEntries: true,
      hasCurrentVersion: true,
      hasS1Data,
    };
  }

  if (hasEntries || hasRelationships) {
    return {
      status: 'stale',
      needsRefresh: true,
      hasDisplayableEntries: true,
      hasEntries: true,
      hasCurrentVersion,
      hasS1Data,
    };
  }

  return {
    status: 'missing',
    needsRefresh: true,
    hasDisplayableEntries: false,
    hasEntries: false,
    hasCurrentVersion,
    hasS1Data: false,
  };
}

import type { IRecommendCache, IRecommendCacheCandidate } from '../../../types';

type RecommendCacheLikeNote = {
  updatedAt?: string;
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
  noteUpdatedAt: string | undefined,
  payload: any
): IRecommendCache {
  const data = payload?.data ?? {};
  const meta = data?.meta ?? {};
  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];
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
    sourceUpdatedAt: noteUpdatedAt,
    generatedAt,
    params: meta?.thresholds,
    diagnostics: meta?.diagnostics,
    byCandidateId,
  };
}

export function getRecommendCacheState(note: RecommendCacheLikeNote | null | undefined): RecommendCacheState {
  const cache = note?.recommendCache ?? null;
  const entries = normalizeEntries(cache);
  const hasEntries = entries.length > 0;
  const hasCurrentVersion =
    !!cache &&
    !!note?.updatedAt &&
    String(cache.sourceUpdatedAt || '') === String(note.updatedAt || '');
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

  if (hasCurrentVersion && !hasEntries) {
    return {
      status: 'current-empty',
      needsRefresh: false,
      hasDisplayableEntries: false,
      hasEntries: false,
      hasCurrentVersion: true,
      hasS1Data: false,
    };
  }

  if (hasCurrentVersion && hasEntries && hasS1Data) {
    return {
      status: 'ready',
      needsRefresh: false,
      hasDisplayableEntries: true,
      hasEntries: true,
      hasCurrentVersion: true,
      hasS1Data: true,
    };
  }

  if (hasEntries) {
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

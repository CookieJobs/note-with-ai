import { describe, expect, it } from 'vitest';
import { buildRecommendCacheFromResponse, getRecommendCacheState } from './recommendCache';

describe('recommend cache freshness', () => {
  it('keeps a revision-matched cache ready when only updatedAt changed', () => {
    const cache = buildRecommendCacheFromResponse(
      { updatedAt: '2026-08-18T00:00:00.000Z', revision: 2 },
      {
        data: {
          recommendations: [{ note: { _id: 'candidate-1' }, s1: 0.9, s2: 0.8 }],
        },
      },
    );

    const state = getRecommendCacheState({
      revision: 2,
      updatedAt: '2026-08-18T00:10:00.000Z',
      recommendCache: cache,
    });

    expect(cache.sourceRevision).toBe(2);
    expect(state.status).toBe('ready');
    expect(state.needsRefresh).toBe(false);
  });

  it('uses the timestamp fallback only for legacy caches without sourceRevision', () => {
    const legacyCache = {
      sourceUpdatedAt: '2026-08-18T00:00:00.000Z',
      byCandidateId: {
        'candidate-1': { s1: 0.9, s2: 0.8 },
      },
    };

    expect(getRecommendCacheState({
      revision: 2,
      updatedAt: '2026-08-18T00:00:00.000Z',
      recommendCache: legacyCache,
    }).status).toBe('ready');

    expect(getRecommendCacheState({
      revision: 2,
      updatedAt: '2026-08-18T00:10:00.000Z',
      recommendCache: legacyCache,
    }).status).toBe('stale');
  });
});

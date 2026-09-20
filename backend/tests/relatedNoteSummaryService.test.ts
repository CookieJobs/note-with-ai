import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectCurrentRelatedCandidateIds } from '../services/relatedNoteSummaryService';

describe('related note summaries', () => {
  it('returns at most five candidate ids only for the current source revision', () => {
    const ids = selectCurrentRelatedCandidateIds({
      revision: 3,
      recommendCache: {
        sourceRevision: 3,
        byCandidateId: { a: {}, b: {}, c: {}, d: {}, e: {}, f: {} },
      },
    });
    assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e']);
  });

  it('returns no candidates for a stale cache', () => {
    assert.deepEqual(selectCurrentRelatedCandidateIds({
      revision: 3,
      recommendCache: { sourceRevision: 2, byCandidateId: { a: {} } },
    }), []);
  });
});


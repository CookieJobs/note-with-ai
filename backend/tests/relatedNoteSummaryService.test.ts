import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Note } from '../models/Note';
import { RelatedNoteSummaryService, selectCurrentRelatedCandidateIds } from '../services/relatedNoteSummaryService';

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

  it('returns only existing candidates owned by the source user, in the cached order', async () => {
    const model = Note as unknown as { findOne: unknown; find: unknown };
    const originalFindOne = model.findOne;
    const originalFind = model.find;
    let candidateFilter: unknown;
    model.findOne = () => ({ lean: async () => ({
      revision: 3,
      recommendCache: {
        sourceRevision: 3,
        byCandidateId: {
          retained: { s1: 0.8, s2: 0.9, type: '强关联', reason: '同一主题' },
          deleted: { s1: 0.7, s2: 0.8 },
        },
      },
    }) });
    model.find = (filter: unknown) => {
      candidateFilter = filter;
      return { lean: async () => [{ _id: 'retained', title: '仍存在', contentText: '候选摘要', revision: 8 }] };
    };
    try {
      const summaries = await new RelatedNoteSummaryService().list('user-A', 'source');
      assert.deepEqual(candidateFilter, { _id: { $in: ['retained', 'deleted'] }, userId: 'user-A' });
      assert.deepEqual(summaries, [{
        noteId: 'retained', title: '仍存在', contentText: '候选摘要',
        type: '强关联', reason: '同一主题', revision: 8,
      }]);
    } finally {
      model.findOne = originalFindOne;
      model.find = originalFind;
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backfillNoteRevisions, type RevisionBackfillModel } from '../scripts/backfill_note_revisions';

describe('backfillNoteRevisions', () => {
  it('sets missing or invalid revisions to one without changing Note timestamps', async () => {
    const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: Record<string, unknown> }> = [];
    const model: RevisionBackfillModel = {
      async updateMany(filter, update, options) {
        calls.push({ filter, update, options });
        return { matchedCount: 3, modifiedCount: 3 };
      },
    };

    const result = await backfillNoteRevisions(model);

    assert.deepEqual(result, { matchedCount: 3, modifiedCount: 3 });
    assert.deepEqual(calls, [{
      filter: {
        $expr: {
          $let: {
            vars: {
              revisionType: { $type: '$revision' },
              revisionNumber: {
                $convert: {
                  input: '$revision',
                  to: 'double',
                  onError: null,
                  onNull: null,
                },
              },
            },
            in: {
              $or: [
                { $not: [{ $in: ['$$revisionType', ['double', 'int', 'long', 'decimal']] }] },
                { $eq: ['$$revisionNumber', null] },
                { $lt: ['$$revisionNumber', 1] },
                { $ne: ['$$revisionNumber', { $trunc: '$$revisionNumber' }] },
              ],
            },
          },
        },
      },
      update: { $set: { revision: 1 } },
      options: { timestamps: false },
    }]);
  });
});

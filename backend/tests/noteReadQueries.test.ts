import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Types } from 'mongoose';
import { Note } from '../models/Note';
import { noteService } from '../services/noteService';
import { noteController } from '../controllers/noteController';
import { UserValidator } from '../utils/userValidation';

describe('authenticated note read queries', () => {
  afterEach(() => mock.restoreAll());
  it('keeps account scope, search and the stable cursor boundary together', async () => {
    const seen: any[] = [];
    mock.method(Note, 'find', (filter: any) => {
      seen.push(filter);
      return { sort: (sort: any) => { assert.deepEqual(sort, { createdAt: -1, _id: -1 }); return { limit: async () => [
        { _id: 'n2', title: '匹配', content: '正文', revision: 1, createdAt: new Date('2026-11-02Z'), updatedAt: new Date('2026-11-02Z') },
        { _id: 'n1', content: '正文', revision: 1, createdAt: new Date('2026-11-01Z'), updatedAt: new Date('2026-11-01Z') },
      ] }; } } as any;
    });
    const first = await noteService.getNotesPage('account-a', { limit: 1, q: '匹配' });
    assert.equal(first.notes[0]._id, 'n2');
    assert.equal(first.pageInfo.hasMore, true);
    await noteService.getNotesPage('account-a', { limit: 1, q: '匹配', cursor: first.pageInfo.nextCursor });
    assert.equal(seen[0].userId, 'account-a');
    assert.ok(seen[0].$and[0].$or[0].title);
    assert.equal(seen[1].$and[1].$or[1]._id.$lt, 'n2');
    await assert.rejects(noteService.getNotesPage('account-a', { q: 'different', cursor: first.pageInfo.nextCursor }), /cursor/i);
  });
  it('aggregates only the authenticated account in a bounded Beijing month', async () => {
    const userId = '507f1f77bcf86cd799439011';
    mock.method(Note, 'aggregate', async (pipeline: any) => {
      assert.equal(String(pipeline[0].$match.userId), userId);
      assert.ok(pipeline[0].$match.userId instanceof Types.ObjectId);
      assert.deepEqual(pipeline[0].$match.createdAt, { $gte: new Date('2024-01-31T16:00:00Z'), $lt: new Date('2024-02-29T16:00:00Z') });
      assert.equal(pipeline[1].$group._id.$dateToString.timezone, 'Asia/Shanghai');
      return [{ _id: '2024-02-01', count: 2 }, { _id: '2024-02-29', count: 1 }];
    });
    assert.deepEqual(await noteService.getNotesCalendar(userId, '2024-02'), {
      month: '2024-02', timezone: 'Asia/Shanghai', noteCount: 3, recordedDayCount: 2,
      days: [{ date: '2024-02-01', count: 2 }, { date: '2024-02-29', count: 1 }],
    });
  });
  it('returns true zero statistics for an empty month', async () => {
    mock.method(Note, 'aggregate', async () => []);
    const stats = await noteService.getNotesCalendar('507f1f77bcf86cd799439011', '2026-11');
    assert.equal(stats.noteCount, 0); assert.equal(stats.recordedDayCount, 0); assert.deepEqual(stats.days, []);
  });
  it('validates search input and uses authentication rather than query authority', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: 'authenticated-user' }) as any);
    mock.method(noteService, 'getNotesPage', async (id: string, options: any) => {
      assert.equal(id, 'authenticated-user'); assert.equal(options.q, 'literal');
      return { notes: [], pageInfo: { hasMore: false, nextCursor: null } };
    });
    const res = { status() { return this; }, json: (body: any) => { assert.equal(body.success, true); } } as any;
    await noteController.getNotes({ query: { q: ' literal ', userId: 'other-user' } } as any, res, () => {});
    await assert.rejects(noteController.getNotes({ query: { q: ['bad'] } } as any, res, () => {}), /搜索/);
  });
});

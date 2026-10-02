import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Note } from '../models/Note';
import UserProfile from '../models/UserProfile';
import UserNoteTopicIndex from '../models/UserNoteTopicIndex';
import { noteService } from '../services/noteService';

describe('noteService maintenance recovery', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('limits summary maintenance in Mongo and reports only the notes it actually scans', async () => {
    const notes = [
      { _id: 'note-1', userId: 'user-1', revision: 3, content: '', contentText: '' },
      { _id: 'note-2', userId: 'user-1', revision: 4, content: '', contentText: '' },
    ];
    let appliedLimit: number | undefined;
    const query = {
      select() { return query; },
      async limit(limit: number) {
        appliedLimit = limit;
        return notes;
      },
    };
    mock.method(Note, 'find', () => query as never);

    const result = await noteService.ensureSummaries('user-1', 2);

    assert.equal(appliedLimit, 2);
    assert.deepEqual(result, { processed: 2, success: 0 });
  });

  it('deletes the topic projection and invalidates an in-flight profile below five notes', async () => {
    const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
    mock.method(Note, 'findOne', async () => ({ _id: 'note-1', userId: 'user-1' }) as any);
    mock.method(Note, 'deleteOne', async () => ({ deletedCount: 1 }) as any);
    mock.method(Note, 'countDocuments', async () => 4);
    mock.method(UserNoteTopicIndex, 'deleteOne', async (filter: Record<string, unknown>) => {
      assert.deepEqual(filter, { userId: 'user-1', noteId: 'note-1' });
      return { deletedCount: 1 } as any;
    });
    mock.method(UserProfile, 'updateOne', async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      calls.push({ filter, update });
      return { matchedCount: 1 } as any;
    });

    await noteService.deleteNote('user-1', 'note-1');

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].filter, { userId: 'user-1' });
    assert.deepEqual(calls[0].update.$inc, { analysisVersion: 1 });
    const set = calls[0].update.$set as Record<string, unknown>;
    assert.ok(set.profileInvalidatedAt instanceof Date);
    assert.equal(set.analysisStatus, 'idle');
    assert.equal(set.analysisStartedAt, null);
    assert.equal(set.analysisError, '笔记数量不足，画像已转为历史快照');
  });
});

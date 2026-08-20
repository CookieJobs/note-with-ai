import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Note } from '../models/Note';
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
});

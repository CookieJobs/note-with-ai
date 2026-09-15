import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Note } from '../models/Note';
import NoteAiPreference from '../models/NoteAiPreference';
import { noteService } from '../services/noteService';
import { decodeNoteCursor, encodeNoteCursor } from '../services/noteListCursor';
import { AppError } from '../utils/errorHandler';

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

describe('noteService note list pagination', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('uses a 30-item default with one lookahead query and batches AI preferences', async () => {
    const createdAt = new Date('2026-09-09T12:00:00.000Z');
    const notes = Array.from({ length: 31 }, (_, index) => ({
      _id: `507f1f77bcf86cd799${(31 - index).toString(16).padStart(6, '0')}`,
      content: `note ${index}`,
      contentText: `note ${index}`,
      title: `note ${index}`,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    }));
    let appliedFilter: unknown;
    let appliedSort: unknown;
    let appliedLimit: number | undefined;
    let preferenceFilter: unknown;
    const query = {
      sort(sort: unknown) { appliedSort = sort; return query; },
      limit(limit: number) { appliedLimit = limit; return query; },
      async lean() { return notes; },
    };
    mock.method(Note, 'find', (filter: unknown) => {
      appliedFilter = filter;
      return query as never;
    });
    mock.method(NoteAiPreference, 'find', (filter: unknown) => {
      preferenceFilter = filter;
      return { lean: async () => [{ noteId: notes[1]._id, included: false }] } as never;
    });

    const page = await noteService.getNotesPage('user-1', {});

    assert.deepEqual(appliedFilter, { userId: 'user-1' });
    assert.deepEqual(appliedSort, { createdAt: -1, _id: -1 });
    assert.equal(appliedLimit, 31);
    assert.deepEqual(preferenceFilter, { userId: 'user-1', noteId: { $in: notes.slice(0, 30).map((note) => note._id) } });
    assert.equal(page.notes.length, 30);
    assert.deepEqual(page.notes.slice(0, 2).map((note) => ({ id: note._id, aiIncluded: note.aiIncluded })), [
      { id: notes[0]._id, aiIncluded: true },
      { id: notes[1]._id, aiIncluded: false },
    ]);
    assert.equal(page.pageInfo.hasNextPage, true);
    assert.equal(decodeNoteCursor(page.pageInfo.nextCursor ?? '').id, notes[29]._id);
  });

  it('caps the page at 50 and continues equal timestamps by descending id without leaking another user', async () => {
    const createdAt = new Date('2026-09-09T12:00:00.000Z');
    const cursor = encodeNoteCursor({ createdAt, id: '507f1f77bcf86cd799439012' });
    let appliedFilter: unknown;
    let appliedLimit: number | undefined;
    const query = {
      sort() { return query; },
      limit(limit: number) { appliedLimit = limit; return query; },
      async lean() {
        return [{
          _id: '507f1f77bcf86cd799439011', content: 'owned', contentText: 'owned', title: 'owned', revision: 1, createdAt, updatedAt: createdAt,
        }];
      },
    };
    mock.method(Note, 'find', (filter: unknown) => {
      appliedFilter = filter;
      return query as never;
    });
    mock.method(NoteAiPreference, 'find', () => ({ lean: async () => [] }) as never);

    const page = await noteService.getNotesPage('owner-1', { limit: 500, cursor });

    assert.equal(appliedLimit, 51);
    assert.deepEqual(appliedFilter, {
      userId: 'owner-1',
      $or: [
        { createdAt: { $lt: createdAt } },
        { createdAt, _id: { $lt: '507f1f77bcf86cd799439012' } },
      ],
    });
    assert.equal(page.notes.length, 1);
    assert.equal(page.pageInfo.hasNextPage, false);
    assert.equal(page.pageInfo.nextCursor, null);
  });

  it('returns one owned note and defaults a missing AI preference to included', async () => {
    const createdAt = new Date('2026-09-09T12:00:00.000Z');
    let noteFilter: unknown;
    mock.method(Note, 'findOne', (filter: unknown) => {
      noteFilter = filter;
      return { lean: async () => ({
        _id: '507f1f77bcf86cd799439011', content: 'owned', contentText: 'owned', title: 'owned', revision: 1, createdAt, updatedAt: createdAt,
      }) } as never;
    });
    mock.method(NoteAiPreference, 'findOne', () => ({ lean: async () => null }) as never);

    const note = await noteService.getNote('owner-1', '507f1f77bcf86cd799439011');

    assert.deepEqual(noteFilter, { _id: '507f1f77bcf86cd799439011', userId: 'owner-1' });
    assert.equal(note.aiIncluded, true);
  });

  it('does not disclose a missing or another user’s note through the single-note lookup', async () => {
    mock.method(Note, 'findOne', () => ({ lean: async () => null }) as never);

    await assert.rejects(
      () => noteService.getNote('owner-1', '507f1f77bcf86cd799439011'),
      (error: unknown) => error instanceof AppError && error.statusCode === 404,
    );
  });
});

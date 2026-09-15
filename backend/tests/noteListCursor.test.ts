import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeNoteCursor, encodeNoteCursor } from '../services/noteListCursor';
import { AppError } from '../utils/errorHandler';

const noteId = '507f1f77bcf86cd799439011';

describe('note list cursor', () => {
  it('round-trips an exact timestamp and note id', () => {
    const createdAt = new Date('2026-09-09T12:34:56.789Z');

    const decoded = decodeNoteCursor(encodeNoteCursor({ createdAt, id: noteId }));

    assert.equal(decoded.createdAt.toISOString(), '2026-09-09T12:34:56.789Z');
    assert.equal(decoded.id, noteId);
  });

  it('rejects malformed base64url cursor data', () => {
    assert.throws(() => decodeNoteCursor('this-is-not-a-cursor'), (error: unknown) => error instanceof AppError && error.statusCode === 400);
  });

  it('rejects a cursor payload with an invalid timestamp', () => {
    const invalidDate = Buffer.from(JSON.stringify({ version: 1, createdAt: 'not-a-date', id: noteId })).toString('base64url');

    assert.throws(() => decodeNoteCursor(invalidDate), (error: unknown) => error instanceof AppError && error.statusCode === 400);
  });

  it('rejects a cursor payload without a Mongo ObjectId', () => {
    const missingId = Buffer.from(JSON.stringify({ version: 1, createdAt: '2026-09-09T12:34:56.789Z' })).toString('base64url');

    assert.throws(() => decodeNoteCursor(missingId), (error: unknown) => error instanceof AppError && error.statusCode === 400);
  });
});

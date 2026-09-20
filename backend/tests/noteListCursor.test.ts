import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeNoteCursor, encodeNoteCursor } from '../services/noteListCursor';

describe('note list cursor', () => {
  it('round-trips the stable createdAt and id boundary', () => {
    const cursor = encodeNoteCursor({ createdAt: new Date('2026-09-20T00:00:00.000Z'), id: 'note-2' });
    assert.deepEqual(decodeNoteCursor(cursor), { createdAt: new Date('2026-09-20T00:00:00.000Z'), id: 'note-2' });
  });

  it('rejects malformed cursors', () => {
    assert.throws(() => decodeNoteCursor('not-a-cursor'), /cursor/i);
  });
});


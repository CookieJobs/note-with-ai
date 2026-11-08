import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSearchQuery, buildNoteSearchFilter, calendarMonthRange } from '../services/noteListQueries';
import { encodeNoteCursor, decodeNoteCursor } from '../services/noteListCursor';

describe('note list read query boundaries', () => {
  it('normalizes literal search and rejects authority-shaped or oversized input', () => {
    assert.equal(parseSearchQuery('  [a].*  '), '[a].*');
    assert.equal(parseSearchQuery(undefined), '');
    assert.throws(() => parseSearchQuery({ $ne: '' }), /搜索/);
    assert.throws(() => parseSearchQuery('a'.repeat(101)), /100/);
  });
  it('matches literal text and falls back only when stored contentText is empty', () => {
    const filter = buildNoteSearchFilter('[a].*') as any;
    assert.equal(filter.$or[0].title.$regex, '\\[a\\]\\.\\*');
    assert.equal(filter.$or[0].title.$options, 'i');
    assert.deepEqual(filter.$or[1].$expr.$regexMatch.input, {
      $cond: [{ $ne: [{ $trim: { input: { $ifNull: ['$contentText', ''] } } }, ''] }, '$contentText', { $ifNull: ['$content', ''] }],
    });
    assert.deepEqual(buildNoteSearchFilter(''), {});
  });
  it('binds search cursors to their normalized query while retaining ordinary cursor compatibility', () => {
    const boundary = { createdAt: new Date('2026-11-07T00:00:00Z'), id: 'abc' };
    const encoded = encodeNoteCursor(boundary, '问题');
    assert.deepEqual(decodeNoteCursor(encoded, '问题'), boundary);
    assert.throws(() => decodeNoteCursor(encoded, '另一个'), /cursor/i);
    assert.throws(() => decodeNoteCursor(encoded), /cursor/i);
    assert.throws(() => decodeNoteCursor(encodeNoteCursor(boundary), '问题'), /cursor/i);
    assert.deepEqual(decodeNoteCursor(encodeNoteCursor(boundary)), boundary);
  });
  it('uses Beijing natural month boundaries including leap February', () => {
    assert.deepEqual(calendarMonthRange('2024-02'), { start: new Date('2024-01-31T16:00:00Z'), end: new Date('2024-02-29T16:00:00Z') });
    assert.deepEqual(calendarMonthRange('2026-12'), { start: new Date('2026-11-30T16:00:00Z'), end: new Date('2026-12-31T16:00:00Z') });
    for (const month of ['2026-13', '2026-00', '2026-1', 'bad', undefined, ['2026-11']]) assert.throws(() => calendarMonthRange(month), /月份/);
  });
});

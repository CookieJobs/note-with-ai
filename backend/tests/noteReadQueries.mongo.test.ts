/* Opt-in against a dedicated local disposable MongoDB, never an application database. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { Note } from '../models/Note';
import { noteService } from '../services/noteService';
const uri = process.env.NOTE_READ_MONGO_TEST_URI;
const account = new Types.ObjectId();
const other = new Types.ObjectId();

describe('note read queries against isolated MongoDB', { skip: !uri }, () => {
  before(async () => {
    if (!/^mongodb:\/\/127\.0\.0\.1:27028\/nwai_notes_feed_test_[a-z0-9_]+$/.test(uri!)) throw Error('A dedicated local note-read test database is required');
    await mongoose.connect(uri!);
    const record = (title: string, content: string, created: string, contentText?: string, userId = account) => ({ userId, title, content, ...(contentText === undefined ? {} : { contentText }), revision: 1, createdAt: new Date(created), updatedAt: new Date(created) });
    await Note.collection.insertMany([
      record('literal', '只有 .* 这个字面量', '2026-11-02T00:00:00Z', ''),
      record('legacy', '**Legacy** https://example.com/image.png', '2026-11-01T00:00:00Z', '  '),
      record('modern', 'obsolete hiddenword', '2026-10-31T00:00:00Z', '当前正文'),
      record('missing', '缺少字段 Legacy', '2026-10-30T00:00:00Z'),
      record('private', '只有 .* 这个字面量 Legacy', '2026-11-03T00:00:00Z', '', other),
      record('leap1', '一', '2024-01-31T16:00:00Z'),
      record('leap2', '二', '2024-02-01T01:00:00Z'),
      record('leap3', '三', '2024-02-29T15:59:59Z'),
      record('before', '前', '2024-01-31T15:59:59Z'),
      record('after', '后', '2024-02-29T16:00:00Z'),
      record('foreign', '他人', '2024-02-15T00:00:00Z', '', other),
    ]);
  });
  after(async () => { if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  it('searches literal special characters, excludes other accounts and does not search obsolete Markdown for modern notes', async () => {
    const literal = await noteService.getNotesPage(String(account), { q: '.*' });
    assert.deepEqual(literal.notes.map(n => n.title), ['literal']);
    const modern = await noteService.getNotesPage(String(account), { q: 'hiddenword' });
    assert.equal(modern.notes.length, 0);
    const oldAddress = await noteService.getNotesPage(String(account), { q: 'image.png' });
    assert.deepEqual(oldAddress.notes.map(n => n.title), ['legacy']);
  });
  it('finds whitespace and missing legacy fallbacks on separate stable pages', async () => {
    const first = await noteService.getNotesPage(String(account), { q: 'legacy', limit: 1 });
    assert.deepEqual(first.notes.map(n => n.title), ['legacy']);
    const second = await noteService.getNotesPage(String(account), { q: 'legacy', limit: 1, cursor: first.pageInfo.nextCursor });
    assert.deepEqual(second.notes.map(n => n.title), ['missing']); assert.equal(second.pageInfo.hasMore, false);
  });
  it('counts distinct Beijing days and excludes both UTC boundary neighbors and foreign notes', async () => {
    assert.deepEqual(await noteService.getNotesCalendar(String(account), '2024-02'), {
      month: '2024-02', timezone: 'Asia/Shanghai', noteCount: 3, recordedDayCount: 2,
      days: [{ date: '2024-02-01', count: 2 }, { date: '2024-02-29', count: 1 }],
    });
  });
});

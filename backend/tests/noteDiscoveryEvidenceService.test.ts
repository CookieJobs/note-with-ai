import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { Note } from '../models/Note';
import { validateEvidence } from '../services/noteDiscoveryEvidenceService';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

const owner = new Types.ObjectId().toHexString();
const foreign = new Types.ObjectId().toHexString();
describe('discovery evidence', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  before(async () => { cleanup = await connectNoteDiscoveryTestMongo('worker'); });
  after(async () => { await cleanup?.(); });
  beforeEach(async () => { await Note.deleteMany({}); });
  it('uses canonical saved text and exact locators, masks images without inferring descriptions', async () => {
    const note = await Note.create({ userId: owner, title: ' Image note ', revision: 3,
      content: 'fallback', contentText: 'First\r\n\r\n\r\nexact phrase ![secret description](https://example.com/image.png)' });
    const input = { noteId: String(note._id), revision: 3, excerpt: 'exact phrase' };
    const [valid] = await validateEvidence(owner, [input]);
    assert.equal(valid.title, 'Image note');
    assert.equal(valid.hasImages, true);
    assert.deepEqual(valid.locator, { start: 7, end: 19 });
    assert.equal(valid.noteDate, note.updatedAt.toISOString());
    await assert.rejects(validateEvidence(owner, [{ ...input, excerpt: 'secret description' }]));
    await assert.rejects(validateEvidence(owner, [{ ...input, excerpt: '[图片]' }]));
  });
  it('rejects partial image marker spans but selects a matching occurrence in original prose', async () => {
    const note = await Note.create({ userId: owner, content: 'intro ![not evidence](https://example.com/image.png) trailing' });
    const input = { noteId: String(note._id), revision: 1, excerpt: '图片' };
    for (const excerpt of ['图片', '片', '[图', '图片]', '[', ']']) {
      await assert.rejects(validateEvidence(owner, [{ ...input, excerpt }]));
    }
    const [mixed] = await validateEvidence(owner, [{ ...input, excerpt: 'intro [图片]' }]);
    assert.deepEqual(mixed.locator, { start: 0, end: 10 });
    await Note.updateOne({ _id: note._id }, { $set: { content: 'intro ![not evidence](https://example.com/image.png) original 图片 prose', revision: 2 } });
    const [valid] = await validateEvidence(owner, [{ ...input, revision: 2 }]);
    assert.deepEqual(valid.locator, { start: 20, end: 22 });
  });
  it('rejects invalid/foreign/deleted IDs, forged excerpts, stale revisions, and unknown fields', async () => {
    const note = await Note.create({ userId: owner, content: 'saved source' });
    const input = { noteId: String(note._id), revision: 1, excerpt: 'saved source' };
    for (const evidence of [
      { ...input, noteId: 'bad' }, { ...input, revision: 2 }, { ...input, excerpt: 'fabricated' },
      { ...input, excerpt: '' }, { ...input, userId: foreign },
    ]) await assert.rejects(validateEvidence(owner, [evidence]));
    await assert.rejects(validateEvidence(foreign, [input]));
    await Note.deleteOne({ _id: note._id });
    await assert.rejects(validateEvidence(owner, [input]));
  });
});

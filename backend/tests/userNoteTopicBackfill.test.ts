import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { after, before, test } from 'node:test';
import { Note } from '../models/Note';
import UserNoteTopicBackfill from '../models/UserNoteTopicBackfill';
import UserNoteTopicIndex from '../models/UserNoteTopicIndex';
import { runTopicBackfillPage } from '../services/userNoteTopicBackfill';
import { buildTopicInputs } from '../services/userNoteTopicInputs';
import { MongoTopicStore } from '../services/userNoteTopicIndexService';

const TEST_DATABASE_URI = 'mongodb://127.0.0.1:27017/note_with_ai_profile_topic_test_20261002_b3';
const RUN_MONGO = process.env.PROFILE_TOPIC_MONGO_TEST === '1';
const topicStore = new MongoTopicStore();
const ownedNotes: mongoose.Types.ObjectId[] = [];
const ownedUsers: mongoose.Types.ObjectId[] = [];
const ownedScopes: string[] = [];

before(async () => {
  if (!RUN_MONGO) return;
  await mongoose.connect(TEST_DATABASE_URI, { serverSelectionTimeoutMS: 5_000 });
  assert.equal(mongoose.connection.name, 'note_with_ai_profile_topic_test_20261002_b3');
});

after(async () => {
  if (!RUN_MONGO) return;
  if (ownedNotes.length) {
    await Note.deleteMany({ _id: { $in: ownedNotes } });
    await UserNoteTopicIndex.deleteMany({ noteId: { $in: ownedNotes } });
  }
  if (ownedScopes.length) await UserNoteTopicBackfill.deleteMany({ scopeKey: { $in: ownedScopes } });
  await mongoose.disconnect();
});

async function createNote(userId: mongoose.Types.ObjectId, noteId = new mongoose.Types.ObjectId()) {
  ownedUsers.push(userId);
  ownedNotes.push(noteId);
  const note = await Note.create({ _id: noteId, userId, content: `note-${noteId}`, title: '标题', revision: 1, keywords: ['人工智能'] });
  return note;
}

test('回填可从持久化游标恢复且重复执行安全', { skip: !RUN_MONGO }, async () => {
  const userId = new mongoose.Types.ObjectId();
  const ids = Array.from({ length: 3 }, () => new mongoose.Types.ObjectId()).sort((a, b) => a.toString().localeCompare(b.toString()));
  for (const id of ids) await createNote(userId, id);
  ownedScopes.push(`user:${userId}`);

  const first = await runTopicBackfillPage({ userId: String(userId), limit: 2 });
  assert.equal(first.scanned, 2);
  assert.equal(first.cursor, ids[1].toString());
  assert.equal(first.done, false);

  // A new service call resumes from the persisted cursor rather than starting over.
  const resumed = await runTopicBackfillPage({ userId: String(userId), limit: 2 });
  assert.equal(resumed.scanned, 1);
  assert.equal(resumed.cursor, null);
  assert.equal(resumed.done, true);
  assert.equal(await UserNoteTopicIndex.countDocuments({ userId }), 3);
  const fencesBeforeRepeat = await Note.find({ _id: { $in: ids } }).select('+topicIndexFence').lean();

  await runTopicBackfillPage({ userId: String(userId), limit: 2 });

  const fencesAfterRepeat = await Note.find({ _id: { $in: ids } }).select('+topicIndexFence').lean();
  assert.equal(await UserNoteTopicIndex.countDocuments({ userId }), 3);
  assert.deepEqual(
    fencesAfterRepeat.map((note: any) => note.topicIndexFence),
    fencesBeforeRepeat.map((note: any) => note.topicIndexFence),
  );
});

test('回填从Note权威成功快照恢复遗漏的索引投影且不重开AI任务', { skip: !RUN_MONGO }, async () => {
  const userId = new mongoose.Types.ObjectId();
  const note = await createNote(userId);
  ownedScopes.push(`user:${userId}`);
  const noteId = String(note._id);
  const originalUpdatedAt = note.updatedAt.getTime();
  const inputs = buildTopicInputs({
    revision: 1, title: '标题', content: `note-${noteId}`, contentText: '', summary: '', keywords: ['人工智能'],
  });
  const indexedAt = new Date('2026-10-02T01:00:00.000Z');
  await Note.updateOne({ _id: note._id }, { $set: {
    topicIndexFence: 7,
    topicIndexScheduled: { sourceRevision: 1, sourceFingerprint: inputs.sourceFingerprint },
    topicIndexSuccess: { sourceRevision: 1, sourceFingerprint: inputs.sourceFingerprint, topics: ['人工智能'], source: 'keywords', indexedAt },
  } }, { timestamps: false });
  await UserNoteTopicIndex.create({
    userId, noteId: note._id, sourceRevision: 1, sourceFingerprint: inputs.sourceFingerprint,
    status: 'processing', topics: [], source: 'keywords', projectionFence: 6, claimToken: 'abandoned',
    leaseUntil: new Date('2026-10-01T00:00:00.000Z'), automaticAttemptCount: 1,
  });

  const firstPassAt = new Date('2026-10-02T01:30:00.000Z');
  await runTopicBackfillPage({ userId: String(userId), limit: 10 }, { store: topicStore, now: () => firstPassAt });

  const projection: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  const currentNote: any = await Note.findById(note._id).select('+topicIndexFence +topicIndexSuccess').lean();
  assert.equal(projection.status, 'ready');
  assert.equal(projection.projectionFence, 7);
  assert.deepEqual(projection.topics, ['人工智能']);
  assert.equal(projection.automaticAttemptCount, 1);
  assert.equal(projection.claimToken, null);
  assert.equal(currentNote.updatedAt.getTime(), originalUpdatedAt);
  assert.deepEqual(currentNote.topicIndexSuccess.topics, ['人工智能']);

  const projectionUpdatedAt = projection.updatedAt.getTime();
  const secondPassAt = new Date('2026-10-02T02:30:00.000Z');
  await runTopicBackfillPage({ userId: String(userId), limit: 10 }, { store: topicStore, now: () => secondPassAt });
  const repeatedProjection: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  const repeatedNote: any = await Note.findById(note._id).select('+topicIndexFence').lean();
  assert.equal(repeatedProjection.updatedAt.getTime(), projectionUpdatedAt, 'a current ready projection is not rewritten on each sweep');
  assert.equal(repeatedNote.updatedAt.getTime(), originalUpdatedAt, 'recovery scans never touch the user-edited timestamp');
  assert.equal(repeatedProjection.automaticAttemptCount, 1, 'a current success does not restart model work');
});

test('来源变化后重新排队，遗留的pending/null任务恢复到due或耗尽状态', { skip: !RUN_MONGO }, async () => {
  const userId = new mongoose.Types.ObjectId();
  const staleNote = await createNote(userId);
  const exhaustedNote = await createNote(userId);
  ownedScopes.push(`user:${userId}`);
  const now = new Date('2026-10-02T04:00:00.000Z');

  const staleId = String(staleNote._id);
  const original = await topicStore.getNote(String(userId), staleId);
  await topicStore.schedule(String(userId), original!, buildTopicInputs(original!), now);
  await Note.updateOne({ _id: staleNote._id }, { $set: { summary: '异步元数据已变化' } }, { timestamps: false });
  const staleClaim = await topicStore.claimNext(String(userId), 'stale-source-claim', now, 'automatic');
  assert.equal(staleClaim, null);
  const repaired: any = await UserNoteTopicIndex.findOne({ userId, noteId: staleNote._id }).lean();
  assert.equal(repaired.status, 'pending');
  assert.ok(repaired.nextAttemptAt instanceof Date);
  assert.notEqual(repaired.sourceFingerprint, original && buildTopicInputs(original).sourceFingerprint);

  const exhaustedId = String(exhaustedNote._id);
  const exhaustedSource = await topicStore.getNote(String(userId), exhaustedId);
  await topicStore.schedule(String(userId), exhaustedSource!, buildTopicInputs(exhaustedSource!), now);
  await UserNoteTopicIndex.updateOne({ userId, noteId: exhaustedNote._id }, {
    $set: { status: 'pending', nextAttemptAt: null, automaticAttemptCount: 3, automaticAttemptFingerprint: buildTopicInputs(exhaustedSource!).sourceFingerprint },
  });
  await runTopicBackfillPage({ userId: String(userId), limit: 10 }, { store: topicStore, now: () => now });
  const exhausted: any = await UserNoteTopicIndex.findOne({ userId, noteId: exhaustedNote._id }).lean();
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.nextAttemptAt, null);
  assert.equal(exhausted.automaticAttemptCount, 3);
});

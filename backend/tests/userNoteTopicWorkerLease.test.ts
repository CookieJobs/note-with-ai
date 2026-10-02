import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { after, before, test } from 'node:test';
import { Note } from '../models/Note';
import UserNoteTopicIndex from '../models/UserNoteTopicIndex';
import UserNoteTopicWorkerLease from '../models/UserNoteTopicWorkerLease';
import { MongoTopicStore, createUserNoteTopicIndexService, DAY, LEASE_MS, topicScopeStartAt } from '../services/userNoteTopicIndexService';
import { buildTopicInputs } from '../services/userNoteTopicInputs';

// This is an isolated, user-approved standalone Mongo test database. Never read project env URIs here.
const TEST_DATABASE_URI = 'mongodb://127.0.0.1:27017/note_with_ai_profile_topic_test_20261002_b2';
const RUN_MONGO = process.env.PROFILE_TOPIC_MONGO_TEST === '1';
const store = new MongoTopicStore();
const ownedNotes: mongoose.Types.ObjectId[] = [];
const ownedUsers: mongoose.Types.ObjectId[] = [];

before(async () => {
  if (!RUN_MONGO) return;
  await mongoose.connect(TEST_DATABASE_URI, { serverSelectionTimeoutMS: 5_000 });
  assert.equal(mongoose.connection.name, 'note_with_ai_profile_topic_test_20261002_b2');
});

after(async () => {
  if (!RUN_MONGO) return;
  if (ownedNotes.length) {
    await Note.deleteMany({ _id: { $in: ownedNotes } });
    await UserNoteTopicIndex.deleteMany({ noteId: { $in: ownedNotes } });
  }
  if (ownedUsers.length) await UserNoteTopicWorkerLease.deleteMany({ userId: { $in: ownedUsers } });
  await mongoose.disconnect();
});

async function noteFixture(fields: Record<string, unknown> = {}) {
  const userId = new mongoose.Types.ObjectId(); const noteId = new mongoose.Types.ObjectId();
  ownedUsers.push(userId); ownedNotes.push(noteId);
  const note: any = await Note.create({ _id: noteId, userId, content: '正文', title: '$title', keywords: ['$topic'], revision: 3, ...fields });
  return { userId, noteId, note };
}

test('standalone Mongo 原子调度、重调度保留历史成功并拒绝旧 source 写入', { skip: !RUN_MONGO }, async () => {
  const { userId, noteId } = await noteFixture();
  const user = String(userId); const id = String(noteId); const now = new Date('2026-10-02T00:00:00Z');
  const initial = await store.getNote(user, id);
  await store.schedule(user, initial!, buildTopicInputs(initial!), now);
  let row: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.status, 'pending');
  assert.equal(row.automaticAttemptCount, 0);
  assert.equal(row.projectionFence, 1);
  assert.deepEqual(row.manualAttemptTimestamps, []);
  assert.equal(row.sourceFingerprint, buildTopicInputs({ revision: 3, content: '正文', title: '$title', keywords: ['$topic'] }).sourceFingerprint);

  const lastSuccess = { sourceRevision: 2, sourceFingerprint: 'old-fingerprint', topics: ['旧成功'], source: 'keywords', indexedAt: now };
  await UserNoteTopicIndex.updateOne({ _id: row._id }, { $set: { status: 'failed', retryMode: 'automatic', nextAttemptAt: null, automaticAttemptCount: 3, lastSuccess } });
  const unchanged = await store.getNote(user, id);
  await store.schedule(user, unchanged!, buildTopicInputs(unchanged!), new Date(now.getTime() + 1));
  row = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.status, 'failed', 'same input schedule must not reopen exhausted work');
  assert.equal(row.nextAttemptAt, null);
  assert.deepEqual(row.lastSuccess.topics, ['旧成功']);

  await Note.updateOne({ _id: noteId }, { $set: { summary: 'changed metadata' } }, { timestamps: false });
  const changed = await store.getNote(user, id);
  await store.schedule(user, changed!, buildTopicInputs(changed!), new Date(now.getTime() + 2));
  row = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.status, 'pending');
  assert.equal(row.automaticAttemptCount, 0);
  assert.equal(row.retryMode, null);
  assert.equal(row.claimToken, null);
  assert.deepEqual(row.lastSuccess.topics, ['旧成功']);
  const stale = await store.schedule(user, unchanged!, buildTopicInputs(unchanged!), new Date(now.getTime() + 3));
  row = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.notEqual(row.sourceFingerprint, buildTopicInputs(unchanged!).sourceFingerprint, 'stale scheduler must not overwrite newer source projection');
  assert.equal(stale, undefined);
});

test('Mongo claim 只取匹配 retryMode 的任务，成功写入受 Note source 与 claim token 保护', { skip: !RUN_MONGO }, async () => {
  const { userId, noteId, note } = await noteFixture(); const user = String(userId); const id = String(noteId);
  const originalUpdatedAt = note.updatedAt.getTime(); const now = new Date();
  const initial = await store.getNote(user, id); const inputs = buildTopicInputs(initial!);
  await store.schedule(user, initial!, inputs, now);
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { retryMode: 'manual' } });
  assert.equal(await store.claimNext(user, 'auto-token', now, 'automatic'), null);
  const job = await store.claimNext(user, 'manual-token', now, 'manual');
  assert.ok(job);
  let row: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.automaticAttemptCount, 0, 'manual claim cannot consume automatic quota');
  assert.equal(await store.finish({ ...job!, claimToken: 'wrong-token' }, ['ＡＩ', 'AI', '人工智能'], now), false);
  assert.equal(await store.finish(job!, ['ＡＩ', 'AI', '人工智能'], now), true);
  row = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.deepEqual(row.lastSuccess.topics, ['人工智能']);

  await Note.updateOne({ _id: noteId }, { $set: { summary: 'first edit' } }, { timestamps: false });
  const current = await store.getNote(user, id);
  await store.schedule(user, current!, buildTopicInputs(current!), now);
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { retryMode: 'manual' } });
  const currentJob = await store.claimNext(user, 'manual-token-2', now, 'manual');
  assert.ok(currentJob);
  assert.equal(await store.finish(job!, ['late old success'], now), false, 'expired prior claim cannot finish after a newer claim');
  const lateClaim = await Note.updateOne({ _id: noteId, topicIndexClaimVersion: { $lt: job!.claimVersion } }, { $set: { topicIndexClaimToken: job!.claimToken, topicIndexClaimVersion: job!.claimVersion } }, { timestamps: false });
  assert.equal(lateClaim.matchedCount, 0, 'older claim cannot reclaim Note after a newer claim token');
  await Note.updateOne({ _id: noteId }, { $set: { summary: 'edit after claim' } }, { timestamps: false });
  assert.equal(await store.finish(currentJob!, ['过期'], now), false);
  await store.fail(currentJob!, 'OLD_FAILURE', now);
  row = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.status, 'pending', 'a stale source claim must schedule the current source');
  assert.ok(row.nextAttemptAt instanceof Date);
  assert.equal(row.sourceFingerprint, buildTopicInputs({ revision: 3, content: '正文', title: '$title', keywords: ['$topic'], summary: 'edit after claim' }).sourceFingerprint);
  assert.equal(row.lastErrorCode, null);
  const finalNote: any = await Note.findById(noteId).select('+topicIndexFence +topicIndexSuccess +topicIndexClaimToken').lean();
  assert.deepEqual(finalNote.topicIndexSuccess.topics, ['人工智能']);
  assert.equal(finalNote.updatedAt.getTime(), originalUpdatedAt, 'internal topic writes do not change user editedAt');
});

test('Mongo 人工重试落实10分钟与滚动24小时限额，并按上海日历月算范围', { skip: !RUN_MONGO }, async () => {
  const base = new Date('2026-10-02T00:00:00Z');
  const { userId, noteId } = await noteFixture({ createdAt: new Date('2026-04-02T00:00:00Z') });
  const user = String(userId); const id = String(noteId);
  const service = createUserNoteTopicIndexService(store, () => new Date(base));
  const initial = await store.getNote(user, id); const inputs = buildTopicInputs(initial!);
  await store.schedule(user, initial!, inputs, base);
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { status: 'failed', sourceRevision: 3, sourceFingerprint: inputs.sourceFingerprint, manualAttemptTimestamps: [0, 1, 2].map((n) => new Date(base.getTime() - n * 60_000)), lastManualAttemptAt: new Date(base.getTime() - 11 * 60_000) } });
  const limited = await service.retryFailedUserTopics(user, 'all');
  assert.equal(limited.rateLimitedCount, 1);
  assert.equal(limited.nextRetryAt, new Date(base.getTime() - 2 * 60_000 + 24 * 60 * 60_000).toISOString());
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { status: 'failed', manualAttemptTimestamps: [1, 2].map((n) => new Date(base.getTime() - n * 60_000)), lastManualAttemptAt: new Date(base.getTime() - 11 * 60_000) } });
  const accepted = await service.retryFailedUserTopics(user, 'all');
  assert.equal(accepted.acceptedCount, 1);
  assert.equal(accepted.rateLimitedCount, 0);
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { status: 'failed' } });
  await Note.updateOne({ _id: noteId }, { $set: { summary: 'new fingerprint' } }, { timestamps: false });
  const edited = await store.getNote(user, id);
  await store.schedule(user, edited!, buildTopicInputs(edited!), base);
  let updated: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(updated.manualAttemptTimestamps.length, 3);
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { status: 'failed' } });
  const crossFingerprint = await service.retryFailedUserTopics(user, 'all');
  assert.equal(crossFingerprint.rateLimitedCount, 1, 'manual quota survives source fingerprint changes');
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { status: 'failed', manualAttemptTimestamps: [base], lastManualAttemptAt: base } });
  const cooldown = await service.retryFailedUserTopics(user, 'all');
  assert.equal(cooldown.rateLimitedCount, 1);
  assert.equal(cooldown.nextRetryAt, new Date(base.getTime() + 10 * 60_000).toISOString());
  assert.equal(topicScopeStartAt('sixMonths', new Date('2026-10-02T01:00:00Z'))?.toISOString(), '2026-04-01T16:00:00.000Z');
});

test('Mongo 自动尝试持久化30秒/120秒间隔并在第三次失败后停止', { skip: !RUN_MONGO }, async () => {
  const { userId, noteId } = await noteFixture({ title: 'no candidates', keywords: [] });
  const user = String(userId); const id = String(noteId); const now = new Date('2026-10-02T00:00:00Z');
  const note = await store.getNote(user, id);
  await store.schedule(user, note!, buildTopicInputs(note!), now);
  const first = await store.claimNext(user, 'auto-1', now, 'automatic'); assert.equal(first?.attemptNumber, 1);
  await store.fail(first!, 'OFFLINE', now);
  let row: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.nextAttemptAt.getTime(), now.getTime() + 30_000);
  assert.equal(await store.claimNext(user, 'early', new Date(now.getTime() + 29_999), 'automatic'), null);
  const second = await store.claimNext(user, 'auto-2', new Date(now.getTime() + 30_000), 'automatic'); assert.equal(second?.attemptNumber, 2);
  await store.fail(second!, 'OFFLINE', new Date(now.getTime() + 30_000));
  row = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.nextAttemptAt.getTime(), now.getTime() + 150_000);
  const third = await store.claimNext(user, 'auto-3', new Date(now.getTime() + 150_000), 'automatic'); assert.equal(third?.attemptNumber, 3);
  await store.fail(third!, 'OFFLINE', new Date(now.getTime() + 150_000));
  row = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.status, 'failed');
  assert.equal(row.automaticAttemptCount, 3);
  assert.equal(await store.claimNext(user, 'auto-4', new Date(now.getTime() + DAY), 'automatic'), null);
});

test('Mongo 并发人工重试只追加一次配额记录', { skip: !RUN_MONGO }, async () => {
  const { userId, noteId } = await noteFixture(); const user = String(userId); const id = String(noteId);
  const now = new Date('2026-10-02T00:00:00Z'); const service = createUserNoteTopicIndexService(store, () => new Date(now));
  const note = await store.getNote(user, id); const inputs = buildTopicInputs(note!);
  await store.schedule(user, note!, inputs, now);
  await UserNoteTopicIndex.updateOne({ userId, noteId }, { $set: { status: 'failed' } });
  const results = await Promise.all([
    service.retryFailedUserTopics(user, 'all'),
    service.retryFailedUserTopics(user, 'all'),
  ]);
  assert.equal(results.reduce((sum, item) => sum + item.acceptedCount, 0), 1);
  const row: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.manualAttemptTimestamps.length, 1);
});

test('过期 claim 不能把结果写成 Note 权威成功快照', { skip: !RUN_MONGO }, async () => {
  const { userId, noteId } = await noteFixture(); const user = String(userId); const id = String(noteId);
  const now = new Date('2026-10-02T00:00:00Z'); const note = await store.getNote(user, id);
  await store.schedule(user, note!, buildTopicInputs(note!), now);
  const job = await store.claimNext(user, 'expiring-worker', now, 'automatic'); assert.ok(job);
  await Note.updateOne({ _id: noteId }, { $set: { topicIndexClaimUntil: now } }, { timestamps: false });
  assert.equal(await store.finish(job!, ['过期结果'], new Date(now.getTime() + 1)), false);
  const authoritative: any = await Note.findById(noteId).select('+topicIndexSuccess +topicIndexClaimToken +topicIndexClaimVersion +topicIndexClaimUntil').lean();
  assert.equal(authoritative.topicIndexSuccess, null);
  assert.equal(authoritative.topicIndexClaimToken, 'expiring-worker');
});

test('standalone Mongo 用户租约跨 worker 原子互斥并在到期后可恢复', { skip: !RUN_MONGO }, async () => {
  const userId = new mongoose.Types.ObjectId(); ownedUsers.push(userId);
  const user = String(userId); const started = new Date('2026-10-02T00:00:00Z');
  assert.equal(await store.claimUserLease(user, 'worker-a', started), true);
  assert.equal(await store.claimUserLease(user, 'worker-b', started), false);
  assert.equal(await store.claimUserLease(user, 'worker-b', new Date(started.getTime() + LEASE_MS + 1)), true);
  await store.releaseUserLease(user, 'worker-a');
  assert.equal(await store.claimUserLease(user, 'worker-c', new Date(started.getTime() + LEASE_MS + 2)), false, 'old token cannot release the replacement lease');
  await store.releaseUserLease(user, 'worker-b');
});

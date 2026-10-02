import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { after, before, test } from 'node:test';
import { Note } from '../models/Note';
import UserNoteTopicIndex from '../models/UserNoteTopicIndex';
import UserNoteTopicWorkerLease from '../models/UserNoteTopicWorkerLease';
import { createUserNoteTopicWorker } from '../services/userNoteTopicIndexWorker';
import { MongoTopicStore, LEASE_MS } from '../services/userNoteTopicIndexService';
import { createUserNoteTopicRuntime } from '../services/userNoteTopicRuntime';
import { buildTopicInputs } from '../services/userNoteTopicInputs';

const TEST_DATABASE_URI = 'mongodb://127.0.0.1:27017/note_with_ai_profile_topic_test_20261002_b3';
const RUN_MONGO = process.env.PROFILE_TOPIC_MONGO_TEST === '1';
const store = new MongoTopicStore();
const ownedNotes: mongoose.Types.ObjectId[] = [];
const ownedUsers: mongoose.Types.ObjectId[] = [];

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
  if (ownedUsers.length) await UserNoteTopicWorkerLease.deleteMany({ userId: { $in: ownedUsers } });
  await mongoose.disconnect();
});

async function noteFixture() {
  const userId = new mongoose.Types.ObjectId();
  const noteId = new mongoose.Types.ObjectId();
  ownedUsers.push(userId);
  ownedNotes.push(noteId);
  const note = await Note.create({ _id: noteId, userId, content: '一篇待提取话题的笔记', title: '标题', keywords: [], summary: '', revision: 1 });
  const projected = await store.getNote(String(userId), String(noteId));
  await store.schedule(String(userId), projected!, buildTopicInputs(projected!), new Date('2026-10-02T00:00:00.000Z'));
  return { userId: String(userId), noteId: String(noteId) };
}

test('运行器回收过期的处理中任务租约', { skip: !RUN_MONGO }, async () => {
  const { userId, noteId } = await noteFixture();
  const started = new Date('2026-10-02T00:00:00.000Z');
  const first = await store.claimNext(userId, 'expired-owner', started, 'automatic');
  assert.ok(first);

  const recovered = await store.claimNext(userId, 'replacement-owner', new Date(started.getTime() + LEASE_MS + 1), 'automatic');

  assert.ok(recovered);
  assert.equal(recovered?.claimToken, 'replacement-owner');
  assert.equal(recovered?.claimVersion, (first?.claimVersion ?? 0) + 1);
  const row: any = await UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  assert.equal(row.status, 'processing');
  assert.equal(row.automaticAttemptCount, 2);
});

test('两个运行器实例不能领取同一用户租约', { skip: !RUN_MONGO }, async () => {
  const { userId } = await noteFixture();
  let entered!: () => void;
  const enteredOnce = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const extract = async () => {
    calls += 1;
    entered();
    await gate;
    return ['并发安全'];
  };
  const firstRuntime = createUserNoteTopicWorker(store, { extract, token: () => 'runner-a' });
  const secondRuntime = createUserNoteTopicWorker(store, { extract, token: () => 'runner-b' });
  const first = firstRuntime.processNext(userId);
  const second = secondRuntime.processNext(userId);
  await enteredOnce;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('运行器不会超过每进程两个并发调用', { skip: !RUN_MONGO }, async () => {
  const users = await Promise.all(Array.from({ length: 4 }, () => noteFixture()));
  let entered!: () => void;
  const twoEntered = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let peak = 0;
  const worker = createUserNoteTopicWorker(store, {
    token: (() => { let next = 0; return () => `bounded-${++next}`; })(),
    extract: async () => {
      active += 1;
      peak = Math.max(peak, active);
      if (peak === 2) entered();
      await gate;
      active -= 1;
      return ['并发上限'];
    },
  });

  const processing = Promise.all(users.map(({ userId }) => worker.processNext(userId)));
  await twoEntered;
  assert.equal(peak, 2);
  release();
  await processing;
  assert.equal(peak, 2);
});

test('单个用户扫描失败时runtime仍等待其余用户并推进游标', async () => {
  const processed: string[] = [];
  let advanced = false;
  const runtime = createUserNoteTopicRuntime({
    worker: { processNext: async (userId: string) => { processed.push(userId); return true; } },
    getCursor: async () => ({ _id: 'runtime', cursor: null, cursorVersion: 0 }),
    listUsers: async () => ({ userIds: ['user-a', 'user-b', 'user-c'], cursor: 'user-c' }),
    backfillPage: async ({ userId }: { userId: string; limit: number }) => { if (userId === 'user-b') throw new Error('temporary'); return { scanned: 0, cursor: null, done: true }; },
    advanceCursor: async (_current: any, next: string | null) => { advanced = next === 'user-c'; return next; },
  } as any);

  await runtime.tick();

  assert.deepEqual(processed.sort(), ['user-a', 'user-b', 'user-c']);
  assert.equal(advanced, true);
  runtime.stop();
});

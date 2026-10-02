import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import { Note } from '../models/Note';
import UserNoteTopicIndex, { type TopicScope } from '../models/UserNoteTopicIndex';
import { buildTopicInputs } from '../services/userNoteTopicInputs';
import { createUserNoteTopicIndexService, topicScopeEndAt, topicScopeStartAt } from '../services/userNoteTopicIndexService';

const enabled = process.env.PROFILE_TOPIC_MONGO_TEST === '1';
const mongoUri = 'mongodb://127.0.0.1:27017/note-with-ai-profile-topic-test';
const fixtureUsers = new Set<string>();
let appServer: Server | undefined;
let baseUrl = '';

before(async () => {
  if (!enabled) return;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'profile-topic-test-only-secret';
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2_000 });
  await Promise.all([User.init(), Note.init(), UserNoteTopicIndex.init()]);
  const [{ default: profileRoutes }, { generateToken }] = await Promise.all([import('../routes/profileRoutes'), import('../utils/jwt')]);
  (globalThis as any).__profileTopicGenerateToken = generateToken;
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  appServer = createServer(app);
  await new Promise<void>((resolve) => appServer!.listen(0, '127.0.0.1', resolve));
  const address = appServer.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (fixtureUsers.size) {
    const ids = [...fixtureUsers].map((id) => new mongoose.Types.ObjectId(id));
    await Promise.all([
      User.deleteMany({ _id: { $in: ids } }),
      Note.deleteMany({ userId: { $in: ids } }),
      UserNoteTopicIndex.deleteMany({ userId: { $in: ids } }),
    ]);
  }
  if (appServer) await new Promise<void>((resolve, reject) => appServer!.close((error) => error ? reject(error) : resolve()));
  if (mongoose.connection.readyState) await mongoose.disconnect();
});

async function fixture() {
  const userId = new mongoose.Types.ObjectId().toString();
  fixtureUsers.add(userId);
  await User.collection.insertOne({ _id: new mongoose.Types.ObjectId(userId), email: `${userId}@topic-test.invalid`, password: 'not-used', isActive: true });
  return {
    userId,
    token: (globalThis as any).__profileTopicGenerateToken({ userId, username: 'topic-test', email: `${userId}@topic-test.invalid` }),
  };
}

async function addNote(userId: string, options: {
  createdAt?: Date;
  revision?: number;
  title?: string;
  content?: string;
  summary?: string;
  keywords?: string[];
  index?: { status: 'ready' | 'pending' | 'processing' | 'failed'; topics?: string[]; lastSuccess?: any; revision?: number; fingerprint?: string };
  authoritativeTopics?: string[];
} = {}) {
  const noteId = new mongoose.Types.ObjectId();
  const note = {
    _id: noteId,
    userId: new mongoose.Types.ObjectId(userId),
    revision: options.revision ?? 1,
    title: options.title ?? '测试笔记',
    content: options.content ?? '测试正文',
    summary: options.summary ?? '',
    keywords: options.keywords ?? [],
    createdAt: options.createdAt ?? new Date(),
    updatedAt: new Date(),
  };
  const input = buildTopicInputs({ ...note, _id: noteId.toString(), userId } as any);
  if (options.authoritativeTopics) {
    (note as any).topicIndexSuccess = {
      sourceRevision: input.sourceRevision,
      sourceFingerprint: input.sourceFingerprint,
      topics: options.authoritativeTopics,
      source: input.source,
      indexedAt: new Date(),
    };
  }
  await Note.collection.insertOne(note);
  if (options.index) {
    await UserNoteTopicIndex.create({
      userId,
      noteId,
      sourceRevision: options.index.revision ?? input.sourceRevision,
      sourceFingerprint: options.index.fingerprint ?? input.sourceFingerprint,
      status: options.index.status,
      topics: options.index.topics ?? [],
      source: input.source,
      indexedAt: options.index.status === 'ready' ? new Date() : null,
      lastSuccess: options.index.lastSuccess ?? null,
    });
  }
  return { ...note, _id: noteId };
}

async function api(token: string, path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
}

test('对不同 ready 笔记去重计数并按话题排序平局项', { skip: !enabled }, async () => {
  const { userId } = await fixture();
  await addNote(userId, { keywords: ['AI', '人工智能', '检索'], index: { status: 'ready', topics: ['人工智能', '人工智能', '检索'] } });
  await addNote(userId, { keywords: ['AI'], index: { status: 'ready', topics: ['人工智能', '知识图谱'] } });
  const result = await createUserNoteTopicIndexService(undefined, () => new Date()).getUserTopicIndex(userId, 'all');
  assert.deepEqual(result.topics, [
    { topic: '人工智能', noteCount: 2 },
    { topic: '检索', noteCount: 1 },
    { topic: '知识图谱', noteCount: 1 },
  ]);
  assert.equal(result.readyNotesInRange, 2);
});

test('将缺失和过期记录计为 pending', { skip: !enabled }, async () => {
  const { userId } = await fixture();
  await addNote(userId);
  await addNote(userId, { index: { status: 'ready', revision: 7, topics: ['旧记录'] } });
  await addNote(userId, { index: { status: 'failed', fingerprint: 'outdated', topics: [] } });
  const result = await createUserNoteTopicIndexService().getUserTopicIndex(userId, 'all');
  assert.equal(result.totalNotesInRange, 3);
  assert.equal(result.pendingNotesInRange, 3);
  assert.equal(result.failedNotesInRange, 0);
  assert.equal(result.indexStatus, 'building');
  assert.equal(result.readyNotesInRange + result.pendingNotesInRange + result.failedNotesInRange, result.totalNotesInRange);
});

test('按状态优先级汇总覆盖并只报告当前失败时间', { skip: !enabled }, async () => {
  const { userId } = await fixture();
  await addNote(userId, { index: { status: 'ready', topics: ['现行'] } });
  const failed = await addNote(userId, { index: { status: 'failed' } });
  await addNote(userId); // missing index is pending
  const failedAt = new Date('2026-10-01T01:00:00Z');
  await UserNoteTopicIndex.updateOne({ noteId: failed._id }, { $set: { errorAt: failedAt } });
  const result = await createUserNoteTopicIndexService().getUserTopicIndex(userId, 'all');
  assert.equal(result.totalNotesInRange, 3);
  assert.equal(result.readyNotesInRange, 1);
  assert.equal(result.pendingNotesInRange, 1);
  assert.equal(result.failedNotesInRange, 1);
  assert.equal(result.indexStatus, 'partial');
  assert.equal(result.lastErrorAt, failedAt.toISOString());
});

test('empty、全部 failed、failed 与 pending 混合、全部 ready 状态符合优先级', { skip: !enabled }, async () => {
  const empty = await fixture();
  assert.equal((await createUserNoteTopicIndexService().getUserTopicIndex(empty.userId, 'all')).indexStatus, 'empty');

  const allFailed = await fixture();
  await addNote(allFailed.userId, { index: { status: 'failed' } });
  assert.equal((await createUserNoteTopicIndexService().getUserTopicIndex(allFailed.userId, 'all')).indexStatus, 'failed');

  const mixed = await fixture();
  await addNote(mixed.userId, { index: { status: 'failed' } });
  await addNote(mixed.userId);
  assert.equal((await createUserNoteTopicIndexService().getUserTopicIndex(mixed.userId, 'all')).indexStatus, 'partial');

  const allReady = await fixture();
  await addNote(allReady.userId, { index: { status: 'ready', topics: ['完成'] } });
  assert.equal((await createUserNoteTopicIndexService().getUserTopicIndex(allReady.userId, 'all')).indexStatus, 'ready');
});

test('同一 revision 的话题来源变化会使原 ready 记录变为 pending', { skip: !enabled }, async () => {
  const { userId } = await fixture();
  const note = await addNote(userId, { keywords: ['旧关键词'], index: { status: 'ready', topics: ['旧关键词'] } });
  await Note.updateOne({ _id: note._id }, { $set: { keywords: ['新关键词'] } });
  const result = await createUserNoteTopicIndexService().getUserTopicIndex(userId, 'all');
  assert.equal(result.readyNotesInRange, 0);
  assert.equal(result.pendingNotesInRange, 1);
  assert.deepEqual(result.topics, []);
});

test('Note 当前成功快照优先于旧 processing 投影且 GET 不改写二者', { skip: !enabled }, async () => {
  const { userId, token } = await fixture();
  const note = await addNote(userId, {
    keywords: ['权威话题'],
    authoritativeTopics: ['权威话题'],
    index: { status: 'processing', revision: 8, topics: ['旧投影'] },
  });
  const beforeNote = await Note.collection.findOne({ _id: note._id });
  const beforeIndex = await UserNoteTopicIndex.findOne({ noteId: note._id }).lean();
  const response = await api(token, '/api/profile/topics?scope=all');
  const body = await response.json() as any;
  assert.equal(body.data.readyNotesInRange, 1);
  assert.deepEqual(body.data.topics, [{ topic: '权威话题', noteCount: 1 }]);
  assert.equal(body.data.pendingNotesInRange, 0);
  assert.deepEqual(await Note.collection.findOne({ _id: note._id }), beforeNote);
  assert.deepEqual(await UserNoteTopicIndex.findOne({ noteId: note._id }).lean(), beforeIndex);
});

test('删除笔记后的孤立索引不进入范围统计', { skip: !enabled }, async () => {
  const { userId } = await fixture();
  const noteId = new mongoose.Types.ObjectId();
  await UserNoteTopicIndex.create({ userId, noteId, sourceRevision: 1, sourceFingerprint: 'orphan', status: 'ready', source: 'keywords', topics: ['孤立'] });
  const result = await createUserNoteTopicIndexService().getUserTopicIndex(userId, 'all');
  assert.equal(result.totalNotesInRange, 0);
  assert.equal(result.indexStatus, 'empty');
  assert.deepEqual(result.topics, []);
});

test('单独返回旧快照', { skip: !enabled }, async () => {
  const { userId } = await fixture();
  const oldAt = new Date('2026-08-01T00:00:00Z');
  await addNote(userId, { keywords: ['当前输入'], index: {
    status: 'failed', revision: 2, topics: [],
    lastSuccess: { sourceRevision: 1, sourceFingerprint: 'old-source', topics: ['历史话题'], source: 'keywords', indexedAt: oldAt },
  } });
  const result = await createUserNoteTopicIndexService().getUserTopicIndex(userId, 'all');
  assert.equal(result.pendingNotesInRange, 1);
  assert.deepEqual(result.topics, []);
  assert.deepEqual(result.staleSnapshot, {
    noteCount: 1,
    indexedAt: oldAt.toISOString(),
    topics: [{ topic: '历史话题', noteCount: 1 }],
    label: '旧快照，不计入当前覆盖',
  });
});

test('处理跨 UTC 午夜的上海时区边界', { skip: !enabled }, async () => {
  const now = new Date('2026-10-02T16:30:00.000Z');
  assert.equal(topicScopeStartAt('year', now)?.toISOString(), '2025-10-02T16:00:00.000Z');
  assert.equal(topicScopeEndAt(now).toISOString(), '2026-10-03T16:00:00.000Z');
  const { userId } = await fixture();
  await addNote(userId, { createdAt: new Date('2025-10-02T15:59:59.999Z'), index: { status: 'ready', topics: ['范围外'] } });
  await addNote(userId, { createdAt: new Date('2025-10-02T16:00:00.000Z'), index: { status: 'ready', topics: ['范围内'] } });
  await addNote(userId, { createdAt: new Date('2026-10-03T15:59:59.999Z'), index: { status: 'ready', topics: ['范围内'] } });
  await addNote(userId, { createdAt: new Date('2026-10-03T16:00:00.000Z'), index: { status: 'ready', topics: ['次日'] } });
  const result = await createUserNoteTopicIndexService(undefined, () => new Date(now)).getUserTopicIndex(userId, 'year');
  assert.equal(result.totalNotesInRange, 2);
  assert.deepEqual(result.topics, [{ topic: '范围内', noteCount: 2 }]);
});

test('将月末回溯限制在该月最后一个日历日', { skip: !enabled }, () => {
  const now = new Date('2026-08-30T16:30:00.000Z'); // Shanghai: Aug 31
  assert.equal(topicScopeStartAt('year', now)?.toISOString(), '2025-08-30T16:00:00.000Z');
  assert.equal(topicScopeStartAt('sixMonths', now)?.toISOString(), '2026-02-27T16:00:00.000Z');
  const leapYearEnd = new Date('2024-08-31T04:00:00.000Z');
  assert.equal(topicScopeStartAt('sixMonths', leapYearEnd)?.toISOString(), '2024-02-28T16:00:00.000Z');
  const leapDay = new Date('2024-02-29T04:00:00.000Z');
  assert.equal(topicScopeStartAt('year', leapDay)?.toISOString(), '2023-02-27T16:00:00.000Z');
});

test('拒绝未知范围', { skip: !enabled }, async () => {
  const { userId } = await fixture();
  await assert.rejects(() => createUserNoteTopicIndexService().getUserTopicIndex(userId, 'quarter' as TopicScope), /范围/);
  const { token } = await fixture();
  const response = await api(token, '/api/profile/topics?scope=quarter');
  assert.equal(response.status, 400);
  const invalidRetry = await api(token, '/api/profile/topics/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'quarter' }) });
  assert.equal(invalidRetry.status, 400);
});

test('话题 GET 和重试 POST 都要求身份认证', { skip: !enabled }, async () => {
  const getResponse = await fetch(`${baseUrl}/api/profile/topics?scope=all`);
  const postResponse = await fetch(`${baseUrl}/api/profile/topics/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
  assert.equal(getResponse.status, 401);
  assert.equal(postResponse.status, 401);
});

test('话题 GET 接口不返回其他用户的笔记', { skip: !enabled }, async () => {
  const owner = await fixture();
  const other = await fixture();
  await addNote(owner.userId, { keywords: ['只属于本人'], index: { status: 'ready', topics: ['只属于本人'] } });
  await addNote(other.userId, { keywords: ['私密内容'], index: { status: 'ready', topics: ['私密内容'] } });
  const response = await api(owner.token, '/api/profile/topics?scope=all');
  const body = await response.json() as any;
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.topics, [{ topic: '只属于本人', noteCount: 1 }]);
  assert.equal(JSON.stringify(body).includes('私密内容'), false);
});

test('重试路由不能将其他用户的失败笔记加入队列', { skip: !enabled }, async () => {
  const caller = await fixture();
  const other = await fixture();
  const callerNote = await addNote(caller.userId, { index: { status: 'failed' } });
  const otherNote = await addNote(other.userId, { index: { status: 'failed' } });
  const response = await api(caller.token, '/api/profile/topics/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(body.data.acceptedCount, 1);
  assert.equal((await UserNoteTopicIndex.findOne({ noteId: callerNote._id })).status, 'pending');
  assert.equal((await UserNoteTopicIndex.findOne({ noteId: otherNote._id })).status, 'failed');
});

test('重试路由返回冷却和限流计数', { skip: !enabled }, async () => {
  const { userId, token } = await fixture();
  const allowed = await addNote(userId, { index: { status: 'failed' } });
  const limited = await addNote(userId, { index: { status: 'failed' } });
  const now = new Date();
  const limitedInput = buildTopicInputs(limited);
  await UserNoteTopicIndex.updateOne({ noteId: limited._id }, { $set: {
    lastManualAttemptAt: now,
    manualAttemptTimestamps: [now],
    sourceRevision: limitedInput.sourceRevision,
    sourceFingerprint: limitedInput.sourceFingerprint,
  } });
  const response = await api(token, '/api/profile/topics/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
  const body = await response.json() as any;
  assert.equal(body.data.acceptedCount, 1);
  assert.equal(body.data.rateLimitedCount, 1);
  assert.ok(body.data.nextRetryAt);
  assert.equal((await UserNoteTopicIndex.findOne({ noteId: allowed._id })).status, 'pending');
  assert.equal((await UserNoteTopicIndex.findOne({ noteId: limited._id })).status, 'failed');
});

test('重试路由不会等待 AI', { skip: !enabled }, async () => {
  const { userId, token } = await fixture();
  const note = await addNote(userId, { index: { status: 'failed' } });
  const beforeNote: any = await Note.findById(note._id).lean();
  const startedAt = Date.now();
  const response = await api(token, '/api/profile/topics/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(body.data.acceptedCount, 1);
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal((await UserNoteTopicIndex.findOne({ noteId: note._id })).status, 'pending');
  const afterNote: any = await Note.findById(note._id).lean();
  assert.deepEqual(afterNote?.topicIndexScheduled, beforeNote?.topicIndexScheduled);
});

test('all 范围包含未来创建的笔记且 GET 不写入调度状态', { skip: !enabled }, async () => {
  const { userId, token } = await fixture();
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const note = await addNote(userId, { createdAt: future, keywords: ['未来'], index: { status: 'ready', topics: ['未来'] } });
  const beforeNote = await Note.findById(note._id).lean();
  const response = await api(token, '/api/profile/topics?scope=all');
  const body = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(body.data.rangeStart, null);
  assert.equal(body.data.rangeEnd, null);
  assert.equal(body.data.totalNotesInRange, 1);
  assert.deepEqual(body.data.topics, [{ topic: '未来', noteCount: 1 }]);
  const afterNote = await Note.findById(note._id).lean();
  assert.deepEqual(afterNote, beforeNote);
});

test('all 范围的重试也包含未来创建的失败笔记', { skip: !enabled }, async () => {
  const { userId, token } = await fixture();
  const note = await addNote(userId, { createdAt: new Date(Date.now() + 24 * 60 * 60 * 1000), index: { status: 'failed' } });
  const response = await api(token, '/api/profile/topics/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
  const body = await response.json() as any;
  assert.equal(body.data.acceptedCount, 1);
  assert.equal((await UserNoteTopicIndex.findOne({ noteId: note._id })).status, 'pending');
});

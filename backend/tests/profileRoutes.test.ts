import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import UserNoteTopicIndex from '../models/UserNoteTopicIndex';
import { createServer, type Server } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

const restores: Array<() => void> = [];

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  restores.push(() => { (target as any)[key] = original; });
}

async function startApp() {
  const [{ createApp }, { generateToken }, User, Note, UserProfile] = await Promise.all([
    import('../index'),
    import('../utils/jwt'),
    import('../models/User').then(m => m.default),
    import('../models/Note').then(m => m.Note),
    import('../models/UserProfile').then(m => m.default),
  ]);
  replaceMethod(User, 'findById', (() => ({
    _id: '507f1f77bcf86cd799439011',
    isActive: true,
    select() { return this; },
    lean: async () => ({ _id: '507f1f77bcf86cd799439011', isActive: true }),
  })) as any);

  const server = createServer(createApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const token = generateToken({
    userId: '507f1f77bcf86cd799439011',
    username: 'test-user',
    email: 'test@example.com',
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
    server,
    Note,
    UserProfile,
  };
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

afterEach(() => {
  mock.restoreAll();
  while (restores.length) restores.pop()?.();
});

describe('profile analysis routes', () => {
  it('rejects explicit keywords before body validation on canonical and legacy note writes', async () => {
    const app = await startApp();
    try {
      for (const [path, method, body] of [
        ['/api/notes', 'POST', { body: { kind: 'plain-text', text: 5 }, keywords: [] }],
        ['/api/notes/note-1', 'PATCH', { expectedRevision: 1, changes: { body: { kind: 'plain-text', text: 5 }, keywords: [] } }],
        ['/api/notes/note-1', 'POST', { title: 5, keywords: [] }],
      ] as const) {
        const response = await fetch(`${app.baseUrl}${path}`, { method,
          headers: { authorization: `Bearer ${app.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal(response.status, 400);
        assert.equal(((await response.json()) as any).code, 'NOTE_TAGS_RETIRED');
      }
    } finally { await closeServer(app.server); }
  });
  it('retires authenticated topic and legacy recommendation routes before any note query', async () => {
    const app = await startApp();
    mock.method(app.Note, 'find', () => { throw new Error('retired route queried notes'); });
    mock.method(app.Note, 'aggregate', () => { throw new Error('retired route aggregated notes'); });
    mock.method(UserNoteTopicIndex, 'find', () => { throw new Error('retired route queried topics'); });
    try {
      for (const [path, method] of [
        ['/api/profile/topics?scope=invalid', 'GET'],
        ['/api/profile/topics/retry', 'POST'],
        ['/api/recommend', 'GET'],
      ] as const) {
        const response = await fetch(`${app.baseUrl}${path}`, {
          method, headers: { authorization: `Bearer ${app.token}`, 'content-type': 'application/json' },
          ...(method === 'POST' ? { body: JSON.stringify({ scope: 'invalid' }) } : {}),
        });
        const body = await response.json() as any;
        assert.equal(response.status, 410);
        assert.equal(body.code, 'NOTE_TAGS_RETIRED');
      }
      assert.equal((await fetch(`${app.baseUrl}/api/profile/topics`)).status, 401);
      assert.equal((await fetch(`${app.baseUrl}/api/profile/topics/retry`, { method: 'POST' })).status, 401);
    } finally {
      await closeServer(app.server);
    }
  });
  it('个人资料 GET 只读并返回旧字段和范围', async () => {
    const app = await startApp();
    const lastAnalyzedAt = '2026-09-01T02:00:00.000Z';
    const profileInvalidatedAt = '2026-09-20T02:00:00.000Z';
    let profileReads = 0;
    let profileWrites = 0;
    mock.method(app.Note, 'countDocuments', async (filter: Record<string, unknown>) => {
      assert.deepEqual(filter, { userId: '507f1f77bcf86cd799439011' });
      return 4;
    });
    mock.method(app.UserProfile, 'findOne', (filter: Record<string, unknown>) => {
      assert.deepEqual(filter, { userId: '507f1f77bcf86cd799439011' });
      profileReads += 1;
      return { lean: async () => ({
        userId: '507f1f77bcf86cd799439011',
        interests: [{ topic: '历史兴趣', score: 0.8 }],
        expertise: [{ area: '复盘', level: 'Advanced' }],
        summary: '历史摘要',
        theme: { themeName: '旧配色', cssType: 'linear-gradient', cssValue: 'linear-gradient(#eee, #ddd)', reasoning: '已退役' },
        analysisStatus: 'ready',
        analysisError: '',
        lastAnalyzedAt: new Date(lastAnalyzedAt),
        analysisInputNoteCount: 12,
        analysisInputScope: 'recent_up_to_20',
        profileInvalidatedAt: new Date(profileInvalidatedAt),
      }) } as any;
    });
    mock.method(app.UserProfile, 'findOneAndUpdate', async () => {
      profileWrites += 1;
      return null;
    });

    try {
      const response = await fetch(`${app.baseUrl}/api/profile/analysis`, {
        headers: { authorization: `Bearer ${app.token}` },
      });
      const body = await response.json() as any;
      assert.equal(response.status, 200);
      assert.deepEqual(body.data, {
        userProfile: null,
        historicalProfile: {
          interests: [{ topic: '历史兴趣', score: 0.8 }],
          expertise: [{ area: '复盘', level: 'Advanced' }],
          summary: '历史摘要',
        },
        profileStatus: 'insufficient_data',
        noteCount: 4,
        analysisError: '',
        analysisFailedAt: null,
        lastAnalyzedAt,
        analysisInputNoteCount: 12,
        analysisInputScope: 'recent_up_to_20',
        profileInvalidatedAt,
      });
      assert.equal(profileReads, 1);
      assert.equal(profileWrites, 0);
    } finally {
      await closeServer(app.server);
    }
  });

  it('个人资料 POST 在笔记少于五篇时拒绝且不排队或写入时间戳', async () => {
    const app = await startApp();
    let queueWrites = 0;
    mock.method(app.Note, 'countDocuments', async () => 4);
    mock.method(app.UserProfile, 'findOne', () => ({ lean: async () => null }) as any);
    mock.method(app.UserProfile, 'findOneAndUpdate', async () => {
      queueWrites += 1;
      return null;
    });

    try {
      const response = await fetch(`${app.baseUrl}/api/profile/analysis`, {
        method: 'POST',
        headers: { authorization: `Bearer ${app.token}` },
      });
      const body = await response.json() as any;
      assert.equal(response.status, 200);
      assert.equal(body.data.accepted, false);
      assert.equal(body.data.profileStatus, 'insufficient_data');
      assert.equal(body.data.reason, 'insufficient_data');
      assert.equal(queueWrites, 0);
    } finally {
      await closeServer(app.server);
    }
  });

  it('刷新失败时保留已有画像缓存并隐藏原始错误', async () => {
    const app = await startApp();
    mock.method(app.Note, 'countDocuments', async () => 6);
    mock.method(app.UserProfile, 'findOne', () => ({ lean: async () => ({
      userId: '507f1f77bcf86cd799439011',
      expertise: [{ area: '复盘', level: 'Advanced' }],
      summary: '缓存摘要仍可见',
      analysisStatus: 'failed',
      analysisError: 'vendor secret: do-not-show',
      analysisFailedAt: new Date('2026-10-01T01:00:00.000Z'),
      lastAnalyzedAt: null,
      analysisInputNoteCount: null,
      analysisInputScope: null,
    }) }) as any);

    try {
      const response = await fetch(`${app.baseUrl}/api/profile/analysis`, {
        headers: { authorization: `Bearer ${app.token}` },
      });
      const body = await response.json() as any;
      assert.equal(body.data.profileStatus, 'failed');
      assert.deepEqual(body.data.userProfile, {
        expertise: [{ area: '复盘', level: 'Advanced' }],
        summary: '缓存摘要仍可见',
      });
      assert.equal(body.data.analysisError, '画像生成失败，请稍后重试');
      assert.equal(body.data.analysisFailedAt, '2026-10-01T01:00:00.000Z');
      assert.equal(JSON.stringify(body).includes('do-not-show'), false);
      assert.equal(body.data.analysisInputNoteCount, null);
      assert.equal(body.data.analysisInputScope, null);
    } finally {
      await closeServer(app.server);
    }
  });

  it('重新达到五篇后失效画像仍只作为历史快照返回，直到新分析成功', async () => {
    const app = await startApp();
    const invalidatedAt = new Date('2026-10-01T03:00:00.000Z');
    mock.method(app.Note, 'countDocuments', async () => 5);
    mock.method(app.UserProfile, 'findOne', () => ({ lean: async () => ({
      userId: '507f1f77bcf86cd799439011',
      expertise: [{ area: '旧能力', level: 'Advanced' }],
      summary: '旧画像',
      analysisStatus: 'idle',
      profileInvalidatedAt: invalidatedAt,
      lastAnalyzedAt: new Date('2026-09-01T00:00:00.000Z'),
      analysisInputNoteCount: 8,
      analysisInputScope: 'recent_up_to_20',
    }) }) as any);

    try {
      const response = await fetch(`${app.baseUrl}/api/profile/analysis`, {
        headers: { authorization: `Bearer ${app.token}` },
      });
      const body = await response.json() as any;
      assert.equal(response.status, 200);
      assert.equal(body.data.profileStatus, 'idle');
      assert.equal(body.data.userProfile, null);
      assert.deepEqual(body.data.historicalProfile, {
        expertise: [{ area: '旧能力', level: 'Advanced' }],
        summary: '旧画像',
      });
      assert.equal(body.data.profileInvalidatedAt, invalidatedAt.toISOString());
    } finally {
      await closeServer(app.server);
    }
  });

  it('失效标记存在时保留新分析的运行状态并继续轮询', async () => {
    const app = await startApp();
    mock.method(app.Note, 'countDocuments', async () => 5);
    mock.method(app.UserProfile, 'findOne', () => ({ lean: async () => ({
      userId: '507f1f77bcf86cd799439011',
      summary: '历史画像',
      analysisStatus: 'running',
      profileInvalidatedAt: new Date('2026-10-01T03:00:00.000Z'),
    }) }) as any);

    try {
      const response = await fetch(`${app.baseUrl}/api/profile/analysis`, {
        headers: { authorization: `Bearer ${app.token}` },
      });
      const body = await response.json() as any;
      assert.equal(body.data.profileStatus, 'analyzing');
      assert.equal(body.data.userProfile, null);
      assert.equal(body.data.historicalProfile.summary, '历史画像');
    } finally {
      await closeServer(app.server);
    }
  });

  it('真实API验证五篇删至四篇再回五篇的历史快照与分析CAS', { skip: process.env.PROFILE_TOPIC_MONGO_TEST !== '1' }, async () => {
    const uri = 'mongodb://127.0.0.1:27017/note_with_ai_profile_topic_test_20261002_b3';
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
    assert.equal(mongoose.connection.name, 'note_with_ai_profile_topic_test_20261002_b3');
    const app = await startApp();
    const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
    const ownedNotes: mongoose.Types.ObjectId[] = [];
    const originalAnalyzedAt = new Date('2026-08-01T00:00:00.000Z');
    try {
      await app.UserProfile.create({
        userId,
        summary: '历史画像',
        expertise: [{ area: '旧能力', level: 'Advanced' }],
        analysisStatus: 'running',
        analysisVersion: 8,
        lastAnalyzedAt: originalAnalyzedAt,
      });
      const notes = await app.Note.create(Array.from({ length: 5 }, (_, index) => ({
        userId,
        content: `生命周期笔记${index}`,
        title: `笔记${index}`,
        revision: 1,
      })));
      ownedNotes.push(...notes.map((note: any) => note._id));

      const headers = { authorization: `Bearer ${app.token}` };
      const before = await (await fetch(`${app.baseUrl}/api/profile/analysis`, { headers })).json() as any;
      assert.equal(before.data.userProfile.summary, '历史画像');

      const priorEnvironment = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const deleted = await fetch(`${app.baseUrl}/api/notes/${notes[0]._id}`, { method: 'DELETE', headers });
      process.env.NODE_ENV = priorEnvironment;
      assert.equal(deleted.status, 200, await deleted.text());
      const fourNotes = await (await fetch(`${app.baseUrl}/api/profile/analysis`, { headers })).json() as any;
      assert.equal(fourNotes.data.noteCount, 4);
      assert.equal(fourNotes.data.profileStatus, 'insufficient_data');
      assert.equal(fourNotes.data.userProfile, null);
      assert.equal(fourNotes.data.historicalProfile.summary, '历史画像');
      assert.ok(fourNotes.data.profileInvalidatedAt);

      const fifth = await app.Note.create({ userId, content: '重新达到五篇', title: '第五篇', revision: 1 });
      ownedNotes.push(fifth._id);
      const backToFive = await (await fetch(`${app.baseUrl}/api/profile/analysis`, { headers })).json() as any;
      assert.equal(backToFive.data.noteCount, 5);
      assert.equal(backToFive.data.userProfile, null);
      assert.equal(backToFive.data.historicalProfile.summary, '历史画像');
      assert.equal(backToFive.data.profileStatus, 'idle');

      const { userAnalysisService } = await import('../services/userAnalysisService');
      replaceMethod(userAnalysisService as any, 'getApiClient', (() => ({
        chatCompletion: async () => JSON.stringify({ summary: '新画像', profileInvalidatedAt: null, analysisVersion: 999 }),
      })) as any);
      const stale = await userAnalysisService.analyzeUserProfile({ userId: String(userId), analysisVersion: 8 });
      assert.deepEqual(stale, { committed: false, reason: 'stale_analysis_version' });
      let profile: any = await app.UserProfile.findOne({ userId }).lean();
      assert.ok(profile.profileInvalidatedAt instanceof Date);
      assert.equal(profile.lastAnalyzedAt.getTime(), originalAnalyzedAt.getTime());
      assert.equal(profile.summary, '历史画像');

      await app.UserProfile.updateOne({ userId, analysisVersion: 9 }, { $set: { analysisStatus: 'running' } });
      const fresh = await userAnalysisService.analyzeUserProfile({ userId: String(userId), analysisVersion: 9 });
      assert.deepEqual(fresh, { committed: true, reason: 'updated' });
      profile = await app.UserProfile.findOne({ userId }).lean();
      assert.ok(profile.profileInvalidatedAt == null);
      assert.equal(profile.summary, '新画像');
      assert.ok(profile.lastAnalyzedAt.getTime() > originalAnalyzedAt.getTime());
    } finally {
      await app.Note.deleteMany({ _id: { $in: ownedNotes } });
      await UserNoteTopicIndex.deleteMany({ noteId: { $in: ownedNotes } });
      await app.UserProfile.deleteOne({ userId });
      await closeServer(app.server);
      await mongoose.disconnect();
    }
  });

  it('个人资料路由挂载后不再提供旧 /api/feed', async () => {
    const app = await startApp();
    try {
      const profileResponse = await fetch(`${app.baseUrl}/api/profile/analysis`);
      const feedResponse = await fetch(`${app.baseUrl}/api/feed`);
      assert.equal(profileResponse.status, 401);
      assert.equal(feedResponse.status, 404);
    } finally {
      await closeServer(app.server);
    }
  });
});

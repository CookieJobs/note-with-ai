import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
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
  it('个人资料 GET 只读并返回旧字段和范围', async () => {
    const app = await startApp();
    const lastAnalyzedAt = '2026-09-01T02:00:00.000Z';
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
        analysisStatus: 'ready',
        analysisError: '',
        lastAnalyzedAt: new Date(lastAnalyzedAt),
        analysisInputNoteCount: 12,
        analysisInputScope: 'recent_up_to_20',
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
        lastAnalyzedAt,
        analysisInputNoteCount: 12,
        analysisInputScope: 'recent_up_to_20',
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
      assert.equal(JSON.stringify(body).includes('do-not-show'), false);
      assert.equal(body.data.analysisInputNoteCount, null);
      assert.equal(body.data.analysisInputScope, null);
    } finally {
      await closeServer(app.server);
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

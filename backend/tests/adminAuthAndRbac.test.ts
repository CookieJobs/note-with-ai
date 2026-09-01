import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import cookieParser from 'cookie-parser';

async function request(app: import('express').Express, path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const server = app.listen(0);
  const address = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.json().catch(() => undefined) };
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('admin-only authentication modules expose the required security primitives', async () => {
  const jwt = await import('../utils/adminJwt');
  const middleware = await import('../middleware/adminAuth');
  const audit = await import('../services/admin/adminAuditService');
  const auth = await import('../services/admin/adminAuthService');

  assert.equal(typeof jwt.signAdminToken, 'function');
  assert.equal(typeof jwt.verifyAdminToken, 'function');
  assert.equal(typeof middleware.requireAdmin, 'function');
  assert.equal(typeof middleware.requireAdminPermission, 'function');
  assert.equal(typeof middleware.requireAdminMutationOrigin, 'function');
  assert.equal(typeof audit.runAuditedAdminCommand, 'function');
  assert.equal(typeof auth.authenticateAdmin, 'function');
});

test('admin JWT is typed separately from ordinary user JWTs', async () => {
  const { signAdminToken, verifyAdminToken } = await import('../utils/adminJwt');
  const token = signAdminToken({ typ: 'admin', adminId: '507f1f77bcf86cd799439011', role: 'viewer', tokenVersion: 0 });
  assert.equal(verifyAdminToken(token).typ, 'admin');
  assert.throws(() => verifyAdminToken('not-a-token'));
  const { config } = await import('../config');
  const roleForged = jwt.sign({ typ: 'admin', adminId: '507f1f77bcf86cd799439011', role: 'not-a-role', tokenVersion: 0 }, config.ADMIN_JWT_SECRET);
  assert.throws(() => verifyAdminToken(roleForged));
});

test('HTTP middleware rejects bearer/wrong-type/inactive/stale sessions and accepts only a current admin cookie', async () => {
  const { createApp } = await import('../index');
  const { signAdminToken } = await import('../utils/adminJwt');
  const { config } = await import('../config');
  const { AdminAccount } = await import('../models/AdminAccount');
  const model = AdminAccount as any;
  const original = model.findById;
  const current = { _id: { toString: () => '507f1f77bcf86cd799439011' }, email: 'owner@example.com', displayName: 'Owner', role: 'owner', isActive: true, tokenVersion: 3 };
  try {
    model.findById = () => ({ lean: async () => current });
    const app = createApp();
    const normal = await request(app, '/api/admin/auth/me', { headers: { authorization: 'Bearer ordinary-user-token' } });
    assert.equal(normal.status, 401);
    const wrongType = jwt.sign({ typ: 'user', adminId: '507f1f77bcf86cd799439011', role: 'owner', tokenVersion: 3 }, config.ADMIN_JWT_SECRET);
    assert.equal((await request(app, '/api/admin/auth/me', { headers: { cookie: `nwai_admin_session=${wrongType}` } })).status, 401);
    current.isActive = false;
    const valid = signAdminToken({ typ: 'admin', adminId: '507f1f77bcf86cd799439011', role: 'owner', tokenVersion: 3 });
    assert.equal((await request(app, '/api/admin/auth/me', { headers: { cookie: `nwai_admin_session=${valid}` } })).status, 401);
    current.isActive = true;
    current.tokenVersion = 4;
    assert.equal((await request(app, '/api/admin/auth/me', { headers: { cookie: `nwai_admin_session=${valid}` } })).status, 401);
    const currentToken = signAdminToken({ typ: 'admin', adminId: '507f1f77bcf86cd799439011', role: 'owner', tokenVersion: 4 });
    const accepted = await request(app, '/api/admin/auth/me', { headers: { cookie: `nwai_admin_session=${currentToken}` } });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body, { success: true, message: '操作成功', data: { admin: { id: '507f1f77bcf86cd799439011', email: 'owner@example.com', displayName: 'Owner', role: 'owner' } } });
  } finally { model.findById = original; }
});

test('HTTP mutation Origin defence, logout envelope, and permission matrix denial use stable envelopes', async () => {
  const { createApp } = await import('../index');
  const { requireAdminPermission, adminNoStore } = await import('../middleware/adminAuth');
  const { globalErrorHandler } = await import('../utils/errorHandler');
  const app = createApp();
  const missing = await request(app, '/api/admin/auth/logout', { method: 'POST' });
  const mismatched = await request(app, '/api/admin/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example' } });
  const allowed = await request(app, '/api/admin/auth/logout', { method: 'POST', headers: { origin: 'http://localhost:3000' } });
  assert.equal(missing.status, 403); assert.equal(mismatched.status, 403);
  assert.deepEqual(allowed.body, { success: true, message: '已登出' });
  assert.match(allowed.headers['set-cookie'], /nwai_admin_session=;/);
  const permissionApp = express(); permissionApp.use(cookieParser()); permissionApp.use(adminNoStore);
  permissionApp.get('/permission/:role', (req, _res, next) => { req.admin = { id: 'a', email: 'a@example.com', displayName: 'A', role: req.params.role as any }; next(); }, requireAdminPermission('feedback:write'), (_req, res) => { res.json({ success: true }); }); permissionApp.use(globalErrorHandler);
  assert.equal((await request(permissionApp, '/permission/support')).status, 200);
  assert.equal((await request(permissionApp, '/permission/viewer')).status, 403);
});

test('HTTP login uses the success envelope, hardened cookie, and preserves rate-limit AppErrors', async () => {
  const { createAdminAuthRouter } = await import('../routes/admin/auth');
  const { adminNoStore } = await import('../middleware/adminAuth');
  const { ErrorHandler, globalErrorHandler } = await import('../utils/errorHandler');
  const appWith = (authenticate: any) => { const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(adminNoStore); app.use('/api/admin/auth', createAdminAuthRouter({ authenticate })); app.use(globalErrorHandler); return app; };
  {
    const success = await request(appWith(async () => ({ admin: { id: 'a', email: 'owner@example.com', displayName: 'Owner', role: 'owner' }, token: 'admin-token' })), '/api/admin/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: { email: 'owner@example.com', password: 'password123', otp: '123456' } });
    assert.equal(success.status, 200);
    assert.deepEqual(success.body, { success: true, message: '登录成功', data: { admin: { id: 'a', email: 'owner@example.com', displayName: 'Owner', role: 'owner' } } });
    assert.match(success.headers['set-cookie'], /nwai_admin_session=admin-token/);
    assert.match(success.headers['set-cookie'], /HttpOnly/); assert.match(success.headers['set-cookie'], /SameSite=Strict/); assert.match(success.headers['set-cookie'], /Path=\/api\/admin/);
    const limited = await request(appWith(async () => { throw ErrorHandler.createAuthenticationError('邮箱、密码或验证码错误'); }), '/api/admin/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: { email: 'owner@example.com', password: 'password123', otp: '123456' } });
    assert.equal(limited.status, 401);
    assert.equal(limited.body.error, '邮箱、密码或验证码错误');
  }
});

test('audited commands retain separate allowlisted command and result metadata', async () => {
  const { AdminAuditLog } = await import('../models/AdminAuditLog');
  const { runAuditedAdminCommand } = await import('../services/admin/adminAuditService');
  const model = AdminAuditLog as any; const originalCreate = model.create; const originalUpdate = model.updateOne;
  const created: any[] = []; const updates: any[] = [];
  try {
    model.create = async (value: unknown) => { created.push(value); return { _id: 'audit-1' }; };
    model.updateOne = async (_query: unknown, update: unknown) => { updates.push(update); };
    await runAuditedAdminCommand({ requestId: 'r', action: 'user.status', metadata: { reason: 'policy', forbiddenContent: 'private note' }, resultMetadata: { nextStatus: 'inactive', forbiddenReply: 'assistant reply' } }, async () => 'ok');
    assert.deepEqual(created[0].metadata, { command: { reason: 'policy' } });
    assert.deepEqual(updates[0].$set.metadata, { command: { reason: 'policy' }, result: { nextStatus: 'inactive' } });
  } finally { model.create = originalCreate; model.updateOne = originalUpdate; }
});

test('a success terminal-audit failure leaves the command audit pending rather than marking it failed', async () => {
  const { AdminAuditLog } = await import('../models/AdminAuditLog');
  const { runAuditedAdminCommand } = await import('../services/admin/adminAuditService');
  const model = AdminAuditLog as any; const create = model.create; const update = model.updateOne; const updates: any[] = [];
  try {
    model.create = async () => ({ _id: 'pending-audit' });
    model.updateOne = async (_query: unknown, value: unknown) => { updates.push(value); throw Object.assign(new Error('transient'), { code: 'ETIMEDOUT' }); };
    await assert.rejects(runAuditedAdminCommand({ requestId: 'request', action: 'command' }, async () => 'mutated'));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].$set.status, 'succeeded');
  } finally { model.create = create; model.updateOne = update; }
});

test('real admin authentication maps limiter rejection to the identical generic credential error and audits it', async () => {
  const { authenticateAdmin, ADMIN_LOGIN_FAILURE_MESSAGE } = await import('../services/admin/adminAuthService');
  const { ErrorHandler } = await import('../utils/errorHandler');
  const { RateLimitService } = await import('../services/auth/RateLimitService');
  const { AdminAuditLog } = await import('../models/AdminAuditLog');
  const limiter = RateLimitService as any; const audit = AdminAuditLog as any;
  const allowed = limiter.assertLoginAllowed; const create = audit.create; const calls: any[] = [];
  try {
    limiter.assertLoginAllowed = async () => { throw ErrorHandler.createValidationError('internal limiter detail'); };
    audit.create = async (value: unknown) => { calls.push(value); };
    await assert.rejects(authenticateAdmin({ email: 'person@example.com', password: 'wrong', otp: '000000', ip: '127.0.0.1', requestId: 'request-1' }), (error: any) => error.statusCode === 401 && error.message === ADMIN_LOGIN_FAILURE_MESSAGE);
    assert.equal(calls[0].action, 'admin.login'); assert.equal(calls[0].metadata.outcome, 'rate_limited'); assert.equal('person@example.com' in calls[0].metadata, false);
  } finally { limiter.assertLoginAllowed = allowed; audit.create = create; }
});

test('real admin login route gives the same generic envelope for unknown accounts, bad passwords, and bad one-window-old TOTPs', async () => {
  // This fails if the route exposes which credential check failed, or if the TOTP
  // validation window is narrowed from the documented one step to zero.
  const { createApp } = await import('../index');
  const { AdminAccount } = await import('../models/AdminAccount');
  const { AdminAuditLog } = await import('../models/AdminAuditLog');
  const { RateLimitService, __rateLimitServiceTestUtils } = await import('../services/auth/RateLimitService');
  const { encryptAdminSecret } = await import('../services/admin/adminCrypto');
  // The service is CommonJS-transpiled, so patch its exact cached dependency
  // while preserving the real validator underneath the observation wrapper.
  const OTPAuth = require('otpauth') as typeof import('otpauth');
  const model = AdminAccount as any;
  const audit = AdminAuditLog as any;
  const originalFindOne = model.findOne;
  const originalUpdateOne = model.updateOne;
  const originalAuditCreate = audit.create;
  const originalKey = process.env.ADMIN_ENCRYPTION_KEY;
  const originalNow = Date.now;
  const originalValidate = (OTPAuth.TOTP.prototype as any).validate;
  const validationWindows: unknown[] = [];
  const now = 1_700_000_010_000;
  const secret = 'JBSWY3DPEHPK3PXP';
  const passwordHash = await (await import('bcryptjs')).hash('password123', 10);
  const account = {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'owner@example.com',
    displayName: 'Owner',
    passwordHash,
    totpSecretEncrypted: '',
    role: 'owner' as const,
    isActive: true,
    tokenVersion: 0,
  };
  try {
    process.env.ADMIN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    Date.now = () => now;
    (OTPAuth.TOTP.prototype as any).validate = function (options: { window: unknown }) {
      validationWindows.push(options.window);
      return originalValidate.call(this, options);
    };
    account.totpSecretEncrypted = encryptAdminSecret(secret);
    model.findOne = ({ email }: { email: string }) => ({
      select: () => ({ lean: async () => email === account.email ? account : null }),
    });
    model.updateOne = async () => ({ acknowledged: true, modifiedCount: 1 });
    audit.create = async () => ({ _id: 'audit-id' });
    __rateLimitServiceTestUtils.setRedisFactory(() => ({
      on() {}, disconnect() {}, multi() { return { incr() { return this; }, expire() { return this; }, async exec() { return [[null, 1], [null, 1]]; } }; },
      async ttl() { return 300; }, async get() { return null; }, async del() { return 2; },
    }) as any);
    const app = createApp();
    const previousStepOtp = new OTPAuth.TOTP({ issuer: 'NoteWithAI', algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: now - 30_000 });
    const attempts = await Promise.all([
      request(app, '/api/admin/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: { email: 'missing@example.com', password: 'password123', otp: '123456' } }),
      request(app, '/api/admin/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: { email: 'owner@example.com', password: 'wrong-password', otp: previousStepOtp } }),
      request(app, '/api/admin/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: { email: 'owner@example.com', password: 'password123', otp: '000000' } }),
    ]);
    for (const response of attempts) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { success: false, error: '邮箱、密码或验证码错误', message: '邮箱、密码或验证码错误', type: 'AUTHENTICATION_ERROR' });
    }
    const accepted = await request(app, '/api/admin/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: { email: 'owner@example.com', password: 'password123', otp: previousStepOtp } });
    assert.equal(accepted.status, 200);
    assert.deepEqual(validationWindows, [1, 1]);
  } finally {
    Date.now = originalNow;
    (OTPAuth.TOTP.prototype as any).validate = originalValidate;
    if (originalKey === undefined) delete process.env.ADMIN_ENCRYPTION_KEY; else process.env.ADMIN_ENCRYPTION_KEY = originalKey;
    model.findOne = originalFindOne;
    model.updateOne = originalUpdateOne;
    audit.create = originalAuditCreate;
    __rateLimitServiceTestUtils.reset();
  }
});

test('real admin login route locks fallback counters and records a content-free rate-limited audit', async () => {
  // This fails if Redis fallback becomes fail-open, the sixth failed login is not
  // normalized at the HTTP boundary, or the lockout lacks its security audit.
  const { createApp } = await import('../index');
  const { AdminAccount } = await import('../models/AdminAccount');
  const { AdminAuditLog } = await import('../models/AdminAuditLog');
  const { __rateLimitServiceTestUtils } = await import('../services/auth/RateLimitService');
  const model = AdminAccount as any;
  const audit = AdminAuditLog as any;
  const originalFindOne = model.findOne;
  const originalAuditCreate = audit.create;
  const audits: any[] = [];
  try {
    model.findOne = () => ({ select: () => ({ lean: async () => null }) });
    audit.create = async (value: unknown) => { audits.push(value); return { _id: `audit-${audits.length}` }; };
    __rateLimitServiceTestUtils.setRedisFactory(() => ({
      on() {}, disconnect() {}, multi() { return { incr() { return this; }, expire() { return this; }, async exec() { throw new Error('redis unavailable'); } }; },
      async ttl() { return -1; }, async get() { throw new Error('redis unavailable'); }, async del() { throw new Error('redis unavailable'); },
    }) as any);
    const app = createApp();
    const login = () => request(app, '/api/admin/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: { email: 'lockout@example.com', password: 'password123', otp: '123456' } });
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login()).status, 401);
    const locked = await login();
    assert.equal(locked.status, 401);
    assert.deepEqual(locked.body, { success: false, error: '邮箱、密码或验证码错误', message: '邮箱、密码或验证码错误', type: 'AUTHENTICATION_ERROR' });
    const lockoutAudit = audits[audits.length - 1];
    assert.equal(lockoutAudit.action, 'admin.login');
    assert.equal(lockoutAudit.status, 'failed');
    assert.equal(lockoutAudit.metadata.outcome, 'rate_limited');
    assert.equal('email' in lockoutAudit.metadata, false);
    assert.match(lockoutAudit.metadata.emailHash, /^[a-f0-9]{64}$/);
  } finally {
    model.findOne = originalFindOne;
    audit.create = originalAuditCreate;
    __rateLimitServiceTestUtils.reset();
  }
});

test('security audit write failures emit bounded request-correlated structured evidence', async () => {
  const { AdminAuditLog } = await import('../models/AdminAuditLog'); const { recordAdminSecurityAudit } = await import('../services/admin/adminAuditService'); const { logger } = await import('../utils/logger');
  const model = AdminAuditLog as any; const create = model.create; const error = (logger as any).error; const emitted: unknown[] = [];
  try {
    model.create = async () => { throw Object.assign(new Error('secret database detail'), { code: 'ETIMEDOUT' }); };
    (logger as any).error = (value: unknown) => emitted.push(value);
    await recordAdminSecurityAudit({ requestId: '11111111-1111-4111-8111-111111111111', action: 'admin.login', status: 'failed', metadata: { outcome: 'failure', reason: 'must-not-log' } });
    assert.deepEqual(JSON.parse(emitted[0] as string), { event: 'admin_security_audit_persistence_failed', code: 'ETIMEDOUT', requestId: '11111111-1111-4111-8111-111111111111', action: 'admin.login', outcome: 'failure' });
  } finally { model.create = create; (logger as any).error = error; }
});

test('permission matrix grants only the documented roles', async () => {
  const { hasAdminPermission } = await import('../middleware/adminAuth');
  assert.equal(hasAdminPermission('owner', 'admins:manage'), true);
  assert.equal(hasAdminPermission('operator', 'admins:manage'), false);
  assert.equal(hasAdminPermission('support', 'feedback:write'), true);
  assert.equal(hasAdminPermission('viewer', 'feedback:write'), false);
  assert.equal(hasAdminPermission('operator', 'users:status'), true);
  assert.equal(hasAdminPermission('support', 'users:status'), false);
  assert.equal(hasAdminPermission('viewer', 'audit:read'), false);
  assert.equal(hasAdminPermission('viewer', 'overview:read'), true);
  const expected: Record<string, string[]> = {
    owner: ['overview:read', 'users:read', 'users:status', 'ai:read', 'ai:retry', 'feedback:read', 'feedback:write', 'system:read', 'audit:read', 'admins:manage'],
    operator: ['overview:read', 'users:read', 'users:status', 'ai:read', 'ai:retry', 'feedback:read', 'feedback:write', 'system:read', 'audit:read'],
    support: ['overview:read', 'users:read', 'ai:read', 'feedback:read', 'feedback:write', 'system:read'],
    viewer: ['overview:read', 'users:read', 'ai:read', 'feedback:read', 'system:read'],
  };
  const all = expected.owner;
  for (const [role, granted] of Object.entries(expected)) for (const permission of all) assert.equal(hasAdminPermission(role as any, permission as any), granted.includes(permission), `${role}:${permission}`);
});

test('configured no-connect app returns the standard no-store admin error envelope and server request id', async () => {
  const { createApp } = await import('../index');
  assert.equal(typeof createApp, 'function');
  const response = await request(createApp(), '/api/admin/auth/me', { headers: { 'x-request-id': '00000000-0000-4000-8000-000000000000' } });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    error: '管理员会话无效',
    message: '管理员会话无效',
    type: 'AUTHENTICATION_ERROR',
  });
  assert.match(response.headers['cache-control'], /no-store/);
  assert.match(response.headers['x-request-id'], /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(response.headers['x-request-id'], '00000000-0000-4000-8000-000000000000');
});

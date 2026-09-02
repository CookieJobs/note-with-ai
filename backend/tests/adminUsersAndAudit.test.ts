import assert from 'node:assert/strict';
import test from 'node:test';

test('admin user views expose only privacy-safe metadata and mask email for viewers', async () => {
  const { toAdminUserView, maskEmail } = await import('../services/admin/adminUserService');
  assert.equal(maskEmail('alice@example.com'), 'a***e@example.com');
  const view = toAdminUserView({
    _id: 'user-1', username: 'alice', email: 'alice@example.com', isActive: true,
    isVerified: true, createdAt: new Date('2026-08-01'), lastActiveAt: new Date('2026-08-31'),
    noteCount: 2, chatCount: 3, aiCalls30d: 4, aiKnownTokens30d: 20,
  }, 'viewer');
  assert.deepEqual(Object.keys(view).sort(), [
    'aiCalls30d','aiKnownTokens30d','chatCount','createdAt','id','isActive',
    'isVerified','lastActiveAt','maskedEmail','noteCount','username',
  ].sort());
  assert.equal(view.maskedEmail, 'a***e@example.com');
  assert.ok(!JSON.stringify(view).match(/password|content|embedding|email@example/));
});

test('admin user view reveals exact email only to support and stronger roles', async () => {
  const { toAdminUserView } = await import('../services/admin/adminUserService');
  const view = toAdminUserView({ _id: 'u', username: 'a', email: 'a@example.com', isActive: true, isVerified: false, createdAt: new Date(), lastActiveAt: null, noteCount: 0, chatCount: 0, aiCalls30d: 0, aiKnownTokens30d: 0 }, 'support');
  assert.equal(view.email, 'a@example.com');
  assert.equal(view.maskedEmail, 'a***@example.com');
});

test('audit query is read-only and sanitizes arbitrary metadata', async () => {
  const { toAdminAuditView } = await import('../services/admin/adminUserService');
  const view = toAdminAuditView({ _id: 'audit-1', requestId: 'req-1', action: 'user.status_changed', status: 'pending', actorId: { email: 'operator@example.com', displayName: 'Op' }, targetType: 'User', targetId: 'u1', metadata: { reason: 'maintenance', content: 'secret body', password: 'secret' }, createdAt: new Date() });
  assert.equal((view.actor as any).displayName, 'Op');
  assert.equal((view.metadata as any).reason, 'maintenance');
  assert.equal((view.metadata as any).content, undefined);
  assert.equal((view.metadata as any).password, undefined);
});

test('admin list date ranges reject invalid order and ranges over 90 days', async () => {
  const { validateAdminDateRange } = await import('../utils/adminQueryValidation');
  assert.doesNotThrow(() => validateAdminDateRange('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'));
  assert.throws(() => validateAdminDateRange('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'), /范围/);
  assert.throws(() => validateAdminDateRange('2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'), /90/);
});

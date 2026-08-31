import assert from 'node:assert/strict';
import test from 'node:test';

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
});

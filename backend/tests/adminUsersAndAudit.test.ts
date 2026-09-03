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
  const view = toAdminUserView({ _id: 'u', username: 'a', email: 'a@example.com', isActive: true, isVerified: false, createdAt: new Date(), lastActiveAt: null, noteCount: 0, chatCount: 0, aiCalls30d: 0, aiKnownTokens30d: 0 }, 'support', true);
  assert.equal(view.email, 'a@example.com');
  assert.equal(view.maskedEmail, 'a***@example.com');
});

test('user list never returns exact email for any role', async () => {
  const { toAdminUserView } = await import('../services/admin/adminUserService');
  for (const role of ['owner', 'operator', 'support', 'viewer'] as const) {
    const view = toAdminUserView({ _id: 'u', username: 'a', email: 'a@example.com', isActive: true, isVerified: false, createdAt: new Date(), lastActiveAt: null, noteCount: 0, chatCount: 0, aiCalls30d: 0, aiKnownTokens30d: 0 }, role);
    assert.equal('email' in view, false);
  }
});

test('audit query is read-only and sanitizes arbitrary metadata', async () => {
  const { toAdminAuditView } = await import('../services/admin/adminUserService');
  const view = toAdminAuditView({ _id: 'audit-1', requestId: 'req-1', action: 'user.status_changed', status: 'pending', actorId: { email: 'operator@example.com', displayName: 'Op' }, targetType: 'User', targetId: 'u1', metadata: { reason: 'maintenance', content: 'secret body', password: 'secret' }, createdAt: new Date() });
  assert.equal((view.actor as any).displayName, 'Op');
  assert.equal((view.metadata as any).reason, 'maintenance');
  assert.equal((view.metadata as any).content, undefined);
  assert.equal((view.metadata as any).password, undefined);
});

test('audit DTO drops objects and arrays even under approved metadata keys', async () => {
  const { toAdminAuditView } = await import('../services/admin/adminUserService');
  const view = toAdminAuditView({
    _id: 'audit-2', requestId: 'req-2', action: 'feedback.updated', status: 'succeeded',
    metadata: {
      command: { reason: { secret: 'body' }, changedFields: ['status'] },
      result: { retryStatus: 'saved', count: 3, idempotent: true },
    },
    createdAt: new Date(),
  });
  assert.deepEqual(view.metadata, { retryStatus: 'saved', count: 3, idempotent: true });
});

test('user list uses bounded grouped lookups instead of per-row enrichment queries', async () => {
  const User = (await import('../models/User')).default as any;
  const Note = (await import('../models/Note')).Note as any;
  const Chat = (await import('../models/Chat')).default as any;
  const AiUsageEvent = (await import('../models/AiUsageEvent')).default as any;
  const originals = { find: User.find, count: User.countDocuments, note: Note.aggregate, chat: Chat.aggregate, ai: AiUsageEvent.aggregate };
  const calls = { note: 0, chat: 0, ai: 0 };
  try {
    User.find = () => ({ select: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => Array.from({ length: 100 }, (_, index) => ({ _id: `507f1f77bcf86cd7994390${String(index).padStart(2, '0')}`, username: `u${index}`, email: `u${index}@example.com`, isActive: true, isVerified: true, createdAt: new Date() })) }) }) }) }) });
    User.countDocuments = async () => 100;
    Note.aggregate = async () => (calls.note += 1, []);
    Chat.aggregate = async () => (calls.chat += 1, []);
    AiUsageEvent.aggregate = async () => (calls.ai += 1, []);
    const { listUsers } = await import('../services/admin/adminUserService');
    const result = await listUsers({ role: 'owner', limit: 100 });
    assert.equal(result.items.length, 100);
    assert.deepEqual(calls, { note: 1, chat: 1, ai: 1 });
  } finally {
    User.find = originals.find; User.countDocuments = originals.count;
    Note.aggregate = originals.note; Chat.aggregate = originals.chat; AiUsageEvent.aggregate = originals.ai;
  }
});

test('admin list date ranges reject invalid order and ranges over 90 days', async () => {
  const { validateAdminDateRange } = await import('../utils/adminQueryValidation');
  assert.doesNotThrow(() => validateAdminDateRange('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'));
  assert.throws(() => validateAdminDateRange('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'), /范围/);
  assert.throws(() => validateAdminDateRange('2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'), /90/);
});

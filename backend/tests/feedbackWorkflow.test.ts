import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { afterEach, mock } from 'node:test';
import cookieParser from 'cookie-parser';

afterEach(() => mock.restoreAll());

test('feedback model has strict bounded public fields and workflow states', async () => {
  const { UserFeedback } = await import('../models/UserFeedback');
  const schema = UserFeedback.schema;
  assert.deepEqual((schema.path('status') as any).enumValues, ['open', 'in_progress', 'resolved']);
  assert.equal(schema.path('content').options.maxlength, 2000);
  assert.equal(schema.path('internalNote').options.select, false);
});

test('feedback admin DTO never includes internal note in the public response', async () => {
  const { toPublicFeedback } = await import('../services/admin/adminFeedbackService');
  const result = toPublicFeedback({ _id: 'f1', status: 'open', category: 'bug', content: 'hello', internalNote: 'private', createdAt: new Date() });
  assert.deepEqual(result, { id: 'f1', status: 'open', category: 'bug', content: 'hello', createdAt: result.createdAt });
  assert.equal('internalNote' in result, false);
});

test('public feedback accepts every shared feedback category', async () => {
  const categories = (await import('../models/UserFeedback')).FEEDBACK_CATEGORIES;
  assert.deepEqual(categories, ['bug', 'experience', 'feature', 'billing', 'other']);
  const feedbackRouter = (await import('../routes/feedback')).default;
  const { UserValidator } = await import('../utils/userValidation');
  const User = (await import('../models/User')).default as any;
  const Window = (await import('../models/FeedbackSubmissionWindow')).default as any;
  const UserFeedback = (await import('../models/UserFeedback')).default as any;
  const { generateToken } = await import('../utils/jwt');
  const originals = { user: User.findById, window: Window.findOneAndUpdate, create: UserFeedback.create };
  mock.method(UserValidator, 'validateAndGetUser', async () => ({ _id: { toString: () => '507f1f77bcf86cd799439011' } }) as never);
  User.findById = () => ({ select: () => ({ lean: async () => ({ isActive: true }) }) });
  Window.findOneAndUpdate = async () => ({ count: 1 });
  UserFeedback.create = async (input: any) => ({ _id: `feedback-${input.category}` });
  const app = express(); app.use(express.json()); app.use('/feedback', feedbackRouter);
  try {
    for (const category of categories) {
      const server = app.listen(0); const port = (server.address() as { port: number }).port;
      try {
        const token = generateToken({ userId: '507f1f77bcf86cd799439011', username: 'user', email: 'user@example.com' });
        const response = await fetch(`http://127.0.0.1:${port}/feedback`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ category, content: 'valid feedback' }) });
        assert.equal(response.status, 201, category);
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    }
  } finally {
    User.findById = originals.user; Window.findOneAndUpdate = originals.window; UserFeedback.create = originals.create;
  }
});

test('admin feedback PATCH requires a trimmed reason and audits reason plus changed fields', async () => {
  const feedbackRouter = (await import('../routes/admin/feedback')).default;
  const { AdminAuditLog } = await import('../models/AdminAuditLog');
  const UserFeedback = (await import('../models/UserFeedback')).default as any;
  const { AdminAccount } = await import('../models/AdminAccount');
  const { signAdminToken } = await import('../utils/adminJwt');
  const { adminNoStore } = await import('../middleware/adminAuth');
  const audit = AdminAuditLog as any;
  const admin = AdminAccount as any;
  const originals = { create: audit.create, update: audit.updateOne, feedback: UserFeedback.findByIdAndUpdate, admin: admin.findById };
  const created: any[] = []; const updates: any[] = [];
  try {
    audit.create = async (value: unknown) => (created.push(value), { _id: 'audit-feedback' });
    audit.updateOne = async (_query: unknown, value: unknown) => { updates.push(value); };
    admin.findById = () => ({ lean: async () => ({ _id: { toString: () => '507f1f77bcf86cd799439011' }, email: 'support@example.com', displayName: 'Support', role: 'support', isActive: true, tokenVersion: 0 }) });
    UserFeedback.findByIdAndUpdate = () => ({ select: () => ({ lean: async () => ({ _id: 'feedback-1', userId: '507f1f77bcf86cd799439011', status: 'resolved', category: 'bug', content: 'public text', internalNote: 'handled', createdAt: new Date(), updatedAt: new Date() }) }) });
    const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(adminNoStore);
    app.use('/feedback', feedbackRouter);
    const server = app.listen(0); const port = (server.address() as { port: number }).port;
    try {
      const cookie = `nwai_admin_session=${signAdminToken({ typ: 'admin', adminId: '507f1f77bcf86cd799439011', role: 'support', tokenVersion: 0 })}`;
      const invalid = await fetch(`http://127.0.0.1:${port}/feedback/feedback-1`, { method: 'PATCH', headers: { origin: 'http://localhost:3000', cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }) });
      assert.equal(invalid.status, 400);
      const response = await fetch(`http://127.0.0.1:${port}/feedback/feedback-1`, { method: 'PATCH', headers: { origin: 'http://localhost:3000', cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved', internalNote: 'handled', reason: '  已完成复现并解决问题  ' }) });
      assert.equal(response.status, 200);
      assert.deepEqual(created[0].metadata, { command: { reason: '已完成复现并解决问题', changedFields: 'status,internalNote' } });
      assert.equal(updates[0].$set.status, 'succeeded');
      assert.deepEqual(updates[0].$set.metadata.result, { status: 'resolved' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  } finally { audit.create = originals.create; audit.updateOne = originals.update; UserFeedback.findByIdAndUpdate = originals.feedback; admin.findById = originals.admin; }
});

test('feedback hourly admission is atomic under concurrent submissions', async () => {
  const Window = (await import('../models/FeedbackSubmissionWindow')).default as any;
  const UserFeedback = (await import('../models/UserFeedback')).default as any;
  const { submitFeedback } = await import('../services/admin/adminFeedbackService');
  const originals = { reserve: Window.findOneAndUpdate, create: UserFeedback.create };
  let count = 0; let created = 0;
  try {
    Window.findOneAndUpdate = async (filter: { count?: { $lt?: number } }) => {
      if (count >= (filter.count?.$lt ?? 0)) return null;
      count += 1;
      return { count };
    };
    UserFeedback.create = async () => ({ _id: `feedback-${++created}` });
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => submitFeedback({ userId: '507f1f77bcf86cd799439011', category: 'bug', content: '并发反馈内容' })));
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 5);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
    assert.equal(created, 5);
  } finally { Window.findOneAndUpdate = originals.reserve; UserFeedback.create = originals.create; }
});

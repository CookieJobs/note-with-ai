import assert from 'node:assert/strict';
import test from 'node:test';

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

import assert from 'node:assert/strict';
import test from 'node:test';

test('failed artifact projection contains no note content fields', async () => {
  const { toFailedArtifactView } = await import('../services/admin/adminAiService');
  const result = toFailedArtifactView({ _id: 'n1', userId: 'u1', revision: 4, enrichment: { embedding: { status: 'failed', sourceRevision: 4, attemptedAt: new Date('2026-08-31'), errorCode: 'EMBED_FAIL' } }, content: 'secret', title: 'private' }, 'embedding');
  assert.deepEqual(result, { noteId: 'n1', userId: 'u1', artifact: 'embedding', sourceRevision: 4, currentRevision: 4, attemptedAt: new Date('2026-08-31'), errorCode: 'EMBED_FAIL' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('usage projection keeps token and cost metadata only', async () => {
  const { toUsageSummary } = await import('../services/admin/adminAiService');
  const result = toUsageSummary([{ _id: { provider: 'deepseek', operation: 'chat' }, calls: 2, succeeded: 1, inputTokens: 12, outputTokens: 8, cost: 5 }]);
  assert.deepEqual(result[0], { provider: 'deepseek', operation: 'chat', calls: 2, succeeded: 1, inputTokens: 12, outputTokens: 8, estimatedCostMicros: 5 });
});

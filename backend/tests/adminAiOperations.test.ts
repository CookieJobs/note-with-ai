import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

afterEach(() => mock.restoreAll());

test('failed artifact projection contains no note content fields', async () => {
  const { toFailedArtifactView } = await import('../services/admin/adminAiService');
  const result = toFailedArtifactView({ _id: 'n1', userId: 'u1', revision: 4, enrichment: { embedding: { status: 'failed', sourceRevision: 4, attemptedAt: new Date('2026-08-31'), errorCode: 'EMBED_FAIL' } }, content: 'secret', title: 'private' }, 'embedding');
  assert.deepEqual(result, { noteId: 'n1', userId: 'u1', artifact: 'embedding', sourceRevision: 4, currentRevision: 4, attemptedAt: new Date('2026-08-31'), errorCode: 'EMBED_FAIL' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('usage projection keeps real token totals when only some successful calls have complete usage', async () => {
  const { toUsageSummary } = await import('../services/admin/adminAiService');
  const result = toUsageSummary([{
    _id: { provider: 'deepseek', operation: 'chat' },
    calls: 3,
    succeeded: 2,
    inputTokens: 12,
    outputTokens: 8,
    knownTokenCalls: 1,
    costKnownCalls: 1,
    cost: 5,
  }]);
  assert.deepEqual(result[0], {
    provider: 'deepseek',
    operation: 'chat',
    calls: 3,
    succeeded: 2,
    inputTokens: 12,
    outputTokens: 8,
    knownTokenCalls: 1,
    costKnownCalls: 1,
    estimatedCostMicros: 5,
  });
});

test('usage projection reports unknown token totals when no successful call has complete usage', async () => {
  const { toUsageSummary } = await import('../services/admin/adminAiService');
  const result = toUsageSummary([{
    _id: { provider: 'dashscope', operation: 'embedding' },
    calls: 2,
    succeeded: 1,
    inputTokens: 0,
    outputTokens: 0,
    knownTokenCalls: 0,
    costKnownCalls: 0,
    cost: 0,
  }]);

  assert.equal(result[0].inputTokens, null);
  assert.equal(result[0].outputTokens, null);
});

test('usage aggregation sums tokens only for succeeded calls with complete provider usage', async () => {
  const AiUsageEvent = (await import('../models/AiUsageEvent')).default;
  const { getAiUsage } = await import('../services/admin/adminAiService');
  let receivedPipeline: Record<string, unknown>[] = [];
  mock.method(AiUsageEvent, 'aggregate', async (pipeline: Record<string, unknown>[]) => {
    receivedPipeline = pipeline;
    return [];
  });

  await getAiUsage({ range: '7d' });

  const group = (receivedPipeline[1] as any).$group;
  const completeSucceededUsage = {
    $and: [
      { $eq: ['$status', 'succeeded'] },
      { $ne: ['$inputTokens', null] },
      { $ne: ['$outputTokens', null] },
    ],
  };
  assert.deepEqual(group.inputTokens, {
    $sum: { $cond: [completeSucceededUsage, '$inputTokens', 0] },
  });
  assert.deepEqual(group.outputTokens, {
    $sum: { $cond: [completeSucceededUsage, '$outputTokens', 0] },
  });
  assert.deepEqual(group.knownTokenCalls, {
    $sum: { $cond: [completeSucceededUsage, 1, 0] },
  });
});

test('unknown grouped cost is null rather than zero', async () => {
  const { toUsageSummary } = await import('../services/admin/adminAiService');
  assert.equal(toUsageSummary([{ _id: { provider: 'dashscope', operation: 'embedding' }, calls: 1, succeeded: 1, inputTokens: 0, outputTokens: 0, cost: null }])[0].estimatedCostMicros, null);
});

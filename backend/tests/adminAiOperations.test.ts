import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

afterEach(() => mock.restoreAll());

type UsageFixture = {
  provider: string;
  operation: string;
  status: 'succeeded' | 'failed' | 'aborted';
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
};

function fieldValue(fixture: UsageFixture, expression: unknown): unknown {
  if (typeof expression !== 'string' || !expression.startsWith('$')) return expression;
  return fixture[expression.slice(1) as keyof UsageFixture];
}

function evaluateMongoExpression(expression: unknown, fixture: UsageFixture): unknown {
  if (typeof expression === 'string') return fieldValue(fixture, expression);
  if (Array.isArray(expression)) {
    return expression.map((item) => evaluateMongoExpression(item, fixture));
  }
  if (!expression || typeof expression !== 'object') return expression;

  const operator = expression as Record<string, unknown>;
  if ('$and' in operator) {
    return (operator.$and as unknown[]).every((item) => evaluateMongoExpression(item, fixture));
  }
  if ('$or' in operator) {
    return (operator.$or as unknown[]).some((item) => evaluateMongoExpression(item, fixture));
  }
  if ('$eq' in operator) {
    const [left, right] = evaluateMongoExpression(operator.$eq, fixture) as unknown[];
    return left === right;
  }
  if ('$ne' in operator) {
    const [left, right] = evaluateMongoExpression(operator.$ne, fixture) as unknown[];
    return left !== right;
  }
  if ('$ifNull' in operator) {
    const [value, fallback] = evaluateMongoExpression(operator.$ifNull, fixture) as unknown[];
    return value === null || value === undefined ? fallback : value;
  }
  if ('$cond' in operator) {
    const [condition, whenTrue, whenFalse] = operator.$cond as unknown[];
    return evaluateMongoExpression(condition, fixture)
      ? evaluateMongoExpression(whenTrue, fixture)
      : evaluateMongoExpression(whenFalse, fixture);
  }
  throw new Error(`Unsupported test aggregation expression: ${JSON.stringify(expression)}`);
}

function executeUsageGroup(
  group: Record<string, unknown>,
  fixtures: UsageFixture[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    _id: { provider: fixtures[0].provider, operation: fixtures[0].operation },
  };
  for (const [key, accumulator] of Object.entries(group)) {
    if (key === '_id') continue;
    const sum = (accumulator as { $sum: unknown }).$sum;
    result[key] = fixtures.reduce(
      (total, fixture) => total + Number(evaluateMongoExpression(sum, fixture)),
      0,
    );
  }
  return result;
}

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
      { $or: [{ $eq: ['$operation', 'embedding'] }, { $ne: ['$outputTokens', null] }] },
    ],
  };
  assert.deepEqual(group.inputTokens, {
    $sum: { $cond: [completeSucceededUsage, '$inputTokens', 0] },
  });
  assert.deepEqual(group.outputTokens, {
    $sum: {
      $cond: [
        completeSucceededUsage,
        { $cond: [{ $eq: ['$operation', 'embedding'] }, 0, '$outputTokens'] },
        0,
      ],
    },
  });
  assert.deepEqual(group.knownTokenCalls, {
    $sum: { $cond: [completeSucceededUsage, 1, 0] },
  });
});

test('usage aggregation behavior excludes failed, aborted, and incomplete usage from known totals', async () => {
  const AiUsageEvent = (await import('../models/AiUsageEvent')).default;
  const { getAiUsage } = await import('../services/admin/adminAiService');
  const fixtures: UsageFixture[] = [
    {
      provider: 'deepseek', operation: 'chat', status: 'succeeded',
      inputTokens: 12, outputTokens: 8, estimatedCostMicros: 5,
    },
    {
      provider: 'deepseek', operation: 'chat', status: 'succeeded',
      inputTokens: null, outputTokens: null, estimatedCostMicros: null,
    },
    {
      provider: 'deepseek', operation: 'chat', status: 'failed',
      inputTokens: 900, outputTokens: 900, estimatedCostMicros: null,
    },
    {
      provider: 'deepseek', operation: 'chat', status: 'aborted',
      inputTokens: 700, outputTokens: 700, estimatedCostMicros: null,
    },
  ];

  mock.method(AiUsageEvent, 'aggregate', async (pipeline: Record<string, unknown>[]) => {
    const group = (pipeline[1] as { $group: Record<string, unknown> }).$group;
    return [executeUsageGroup(group, fixtures)];
  });

  const result = await getAiUsage({ range: '7d' });

  assert.deepEqual(result.groups[0], {
    provider: 'deepseek',
    operation: 'chat',
    calls: 4,
    succeeded: 2,
    inputTokens: 12,
    outputTokens: 8,
    knownTokenCalls: 1,
    costKnownCalls: 1,
    estimatedCostMicros: 5,
  });
});

test('unknown grouped cost is null rather than zero', async () => {
  const { toUsageSummary } = await import('../services/admin/adminAiService');
  assert.equal(toUsageSummary([{ _id: { provider: 'dashscope', operation: 'embedding' }, calls: 1, succeeded: 1, inputTokens: 0, outputTokens: 0, cost: null }])[0].estimatedCostMicros, null);
});

test('embedding groups use input-only telemetry coverage while chat requires both directions', async () => {
  const { toUsageSummary } = await import('../services/admin/adminAiService');
  const groups = toUsageSummary([
    { _id: { provider: 'openrouter', operation: 'embedding' }, calls: 2, succeeded: 2, inputTokens: 15, outputTokens: 0, knownTokenCalls: 1, costKnownCalls: 1, cost: 3 },
    { _id: { provider: 'deepseek', operation: 'chat' }, calls: 1, succeeded: 1, inputTokens: 9, outputTokens: 0, knownTokenCalls: 0, costKnownCalls: 0, cost: 0 },
  ]);
  assert.deepEqual(groups[0], { provider: 'openrouter', operation: 'embedding', calls: 2, succeeded: 2, inputTokens: 15, outputTokens: null, knownTokenCalls: 1, costKnownCalls: 1, estimatedCostMicros: 3 });
  assert.equal(groups[1].inputTokens, null);
  assert.equal(groups[1].outputTokens, null);
});

test('retry failure status is preserved as a failed audit terminal state', async () => {
  const { AdminAuditLog } = await import('../models/AdminAuditLog');
  const { runAuditedAdminCommand } = await import('../services/admin/adminAuditService');
  const model = AdminAuditLog as any; const create = model.create; const update = model.updateOne; const updates: any[] = [];
  try {
    model.create = async () => ({ _id: 'audit-retry' });
    model.updateOne = async (_query: unknown, value: unknown) => { updates.push(value); };
    const result = await runAuditedAdminCommand({ requestId: 'retry-request', action: 'ai.artifact_retry' }, async () => ({ retryStatus: 'failed', errorCode: 'EMBEDDING_PROVIDER_FAILED' }));
    assert.deepEqual(result, { retryStatus: 'failed', errorCode: 'EMBEDDING_PROVIDER_FAILED' });
    assert.equal(updates[0].$set.status, 'failed');
    assert.deepEqual(updates[0].$set.metadata.result, { retryStatus: 'failed' });
    assert.equal(updates[0].$set.errorCode, 'EMBEDDING_PROVIDER_FAILED');
  } finally { model.create = create; model.updateOne = update; }
});

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
const models = [
  require('../models/User').default,
  require('../models/Note').Note,
  require('../models/Chat').default,
  require('../models/ProductEvent').default,
  require('../models/AiUsageEvent').default,
];
const originals = new Map<object, unknown>();
afterEach(() => { for (const [model, aggregate] of originals) (model as any).aggregate = aggregate; originals.clear(); });
function mockAggregates(values: Record<string, any[]>) {
  for (const model of models) {
    originals.set(model, (model as any).aggregate);
    (model as any).aggregate = async () => values[model.modelName] ?? [];
  }
}

test('overview aggregates bounded metrics, fills buckets, and never exposes content', async () => {
  mockAggregates({
    User: [{ total: 4, todayNew: 1, activation: 2 }],
    Note: [{ total: 5 }, { _id: '2026-08-31', value: 2 }, { failed: 3 }],
    Chat: [{ total: 2 }],
    ProductEvent: [{ _id: '2026-08-31', value: 3 }, { _id: '2026-08-30', value: 1 }, { dau: 3, wau: 3, mau: 3 }],
    AiUsageEvent: [{ succeeded: 3, total: 4, inputKnown: 2, outputKnown: 2, inputTokens: 100, outputTokens: 50 }],
  });
  const { getOverview } = await import('../services/admin/adminOverviewService');
  const result = await getOverview({ range: '7d', now: new Date('2026-09-01T04:00:00.000Z') });
  assert.equal(result.summary.totalUsers, 4);
  assert.equal(result.summary.dau, 3);
  assert.equal(result.retention.d30, null);
  assert.equal(result.coverage.tokens.knownCalls, 2);
  assert.equal(result.coverage.tokens.totalSucceededCalls, 3);
  assert.ok(Array.isArray(result.timeseries));
  assert.ok(!JSON.stringify(result).includes('content'));
});

test('overview rejects unsupported ranges', async () => {
  const { getOverview } = await import('../services/admin/adminOverviewService');
  await assert.rejects(() => getOverview({ range: '91d' as never }), /range|范围/);
});

test('system health exposes only safe public fields', async () => {
  mockAggregates({ Note: [{ failed: 2 }], AiUsageEvent: [{ succeeded: 8, total: 10 }] });
  const { getSystemHealth } = await import('../services/admin/adminOverviewService');
  const result = await getSystemHealth();
  assert.equal(result.failedArtifacts, 2);
  assert.equal(result.aiSuccessRate24h, 0.8);
  assert.equal(result.mongo.readyState, 'disconnected');
  assert.ok(!JSON.stringify(result).includes('MONGODB_URI'));
  assert.ok(!JSON.stringify(result).includes('127.0.0.1'));
  void mongoose;
});

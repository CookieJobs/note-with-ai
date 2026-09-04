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
  assert.equal(result.retention.d30, 0);
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

test('overview reads independent Shanghai active windows and real cost coverage', async () => {
  const ProductEvent = models[3] as any;
  const original = ProductEvent.aggregate;
  let productCalls = 0;
  ProductEvent.aggregate = async (pipeline: any[]) => {
    if (pipeline[0]?.$match?.name === 'user_active_day') {
      productCalls += 1;
      return [{ value: 2 }, { value: 5 }, { value: 9 }][productCalls - 1];
    }
    return [];
  };
  const AiUsageEvent = models[4] as any;
  const aiOriginal = AiUsageEvent.aggregate;
  AiUsageEvent.aggregate = async () => [{ summary: [{ succeeded: 4, total: 6, inputKnown: 3, outputKnown: 3, costKnown: 2, cost: 120, inputTokens: 30, outputTokens: 20 }] }];
  const Note = models[1] as any; const noteOriginal = Note.aggregate; Note.aggregate = async () => [{ total: [{ value: 0 }] }];
  const Chat = models[2] as any; const chatOriginal = Chat.aggregate; Chat.aggregate = async () => [{ total: [{ value: 0 }] }];
  const User = models[0] as any; const userOriginal = User.aggregate;
  User.aggregate = async () => [{ total: [{ value: 1 }], todayNew: [{ value: 0 }], activation: [{ value: 1 }] }];
  try {
    const { getOverview } = await import('../services/admin/adminOverviewService');
    const result = await getOverview({ range: '7d', now: new Date('2026-09-01T04:00:00.000Z') });
    assert.deepEqual([result.summary.dau, result.summary.wau, result.summary.mau], [2, 5, 9]);
    assert.equal(result.costCoverage.knownCalls, 2);
    assert.equal(result.costCoverage.estimatedCostMicros, 120);
    assert.equal(result.costCoverage.rate, 0.5);
  } finally { ProductEvent.aggregate = original; AiUsageEvent.aggregate = aiOriginal; User.aggregate = userOriginal; Note.aggregate = noteOriginal; Chat.aggregate = chatOriginal; }
});

test('cohort retention reports mature ratios and null only before an observation window exists', async () => {
  const User = models[0] as any;
  const original = User.aggregate;
  try {
    User.aggregate = async () => [{ total: 4, retained: 1 }];
    const { getCohortRetention } = await import('../services/admin/adminOverviewService');
    assert.equal(await getCohortRetention(1, new Date('2026-09-04T04:00:00.000Z')), 0.25);
    User.aggregate = async () => [];
    assert.equal(await getCohortRetention(7, new Date('2026-09-04T04:00:00.000Z')), null);
  } finally { User.aggregate = original; }
});

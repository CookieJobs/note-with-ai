import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import dotenv from 'dotenv';
import { evaluationPreflight, EVALUATION_URI, assertEvaluationBinding, assertEvaluationBatchSafe,
  evaluationSettlementSummary, type EvaluationLedger } from '../scripts/noteContinuationEvaluationSafety';
const explicit = (): NodeJS.ProcessEnv => ({
  NOTE_DISCOVERY_EVAL_ALLOW_PAID: 'yes', NOTE_DISCOVERY_TEST_MONGO_URI: EVALUATION_URI,
  DEEPSEEK_API_KEY: 'synthetic-only-key', NOTE_DISCOVERY_ENABLED: 'true',
  NOTE_DISCOVERY_MODEL: 'deepseek-flash', NOTE_DISCOVERY_PRICED_MODEL: 'deepseek-flash',
  EMBEDDING_PROVIDER: 'openrouter', EMBEDDING_MODEL: 'synthetic-embedding',
  NOTE_DISCOVERY_PRICED_EMBEDDING_PROVIDER: 'openrouter', NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL: 'synthetic-embedding',
  NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION: '2', NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION: '8',
  NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION: '0', NOTE_DISCOVERY_USER_DAILY_CNY: '2',
  NOTE_DISCOVERY_GLOBAL_DAILY_CNY: '2', NOTE_DISCOVERY_RUN_RESERVATION_CNY: '0.1',
  NOTE_DISCOVERY_EVAL_MAX_CNY_MICROS: '2100000', NOTE_DISCOVERY_EVAL_APPROVAL_ID: 'synthetic-approval',
  NOTE_DISCOVERY_EVAL_PRICE_VERIFIED_AT: '2026-11-21',
});
test('process preflight requires every explicit paid setting before config can supply defaults', () => {
  assert.equal(evaluationPreflight(explicit()).maxMicros, 2100000);
  for (const key of Object.keys(explicit())) {
    const env = explicit(); delete env[key];
    assert.throws(() => evaluationPreflight(env), { name: 'Error' }, key);
  }
  for (const value of [EVALUATION_URI + '_other', 'mongodb://localhost:27028/nwai_discovery_test_live_evaluation']) {
    assert.throws(() => evaluationPreflight({ ...explicit(), NOTE_DISCOVERY_TEST_MONGO_URI: value }), { message: 'EVAL_FIXED_DATABASE_REQUIRED' });
  }
});
test('first batch approval binds cap, model, prices, limits and key without storing plaintext key', () => {
  const metadata = evaluationPreflight(explicit()).metadata;
  assert.equal(JSON.stringify(metadata).includes('synthetic-only-key'), false);
  assertEvaluationBinding(structuredClone(metadata), metadata);
  for (const patch of [{ NOTE_DISCOVERY_EVAL_MAX_CNY_MICROS: '2000000' },
    { NOTE_DISCOVERY_MODEL: 'deepseek-v4-pro', NOTE_DISCOVERY_PRICED_MODEL: 'deepseek-v4-pro' },
    { NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION: '3' }, { NOTE_DISCOVERY_MAX_MODEL_CALLS: '2' },
    { DEEPSEEK_API_KEY: 'another-synthetic-key' }]) {
    assert.throws(() => assertEvaluationBinding(metadata, evaluationPreflight({ ...explicit(), ...patch }).metadata),
      { message: 'EVAL_APPROVAL_CONFIGURATION_CHANGED' });
  }
});
const ledger = (): EvaluationLedger => ({ spentTotalMicros: 12, reservedTotalMicros: 0,
  reservations: [{ state: 'settled', delivery: 'response_received', outcome: 'known', reservedMicros: 20, settledMicros: 12 }] });
test('batch stop spans accounts and dates for unknown, unsettled and blocked usage', () => {
  assertEvaluationBatchSafe([ledger()], []);
  for (const patch of [{ blockedAt: new Date() }, { reservedTotalMicros: 1 },
    { reservations: [{ ...ledger().reservations[0], state: 'reserved' }] },
    { reservations: [{ ...ledger().reservations[0], delivery: 'delivery_unknown' }] },
    { reservations: [{ ...ledger().reservations[0], outcome: 'unknown' }] }]) {
    assert.throws(() => assertEvaluationBatchSafe([{ ...ledger(), ...patch }], []));
  }
  assert.throws(() => assertEvaluationBatchSafe([], [{ providerDeliveryUnknown: true }]), { message: 'EVAL_BATCH_DELIVERY_UNKNOWN' });
  assert.deepEqual(evaluationSettlementSummary([ledger()]), {
    spentMicros: 12, reservedMicros: 0, blocked: false, unsettledReservations: 0, unknownReservations: 0,
  });
});

test('process-only config never calls root dotenv loader', async () => {
  const previous = { ...process.env };
  const loader = mock.method(dotenv, 'config', () => { throw new Error('Root dotenv must not be accessed'); });
  try {
    Object.assign(process.env, explicit(), {
      NOTE_DISCOVERY_EVAL_PROCESS_ONLY: 'true', NODE_ENV: 'test', ADMIN_LOCAL_PASSWORD_ONLY: 'false',
      JWT_SECRET: 'synthetic-unused', ADMIN_JWT_SECRET: 'synthetic-unused-admin-secret-000000000',
      ADMIN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), REDIS_URL: 'redis://127.0.0.1:6379',
      QQ_EMAIL_USER: 'synthetic@example.invalid', QQ_EMAIL_PASS: 'synthetic-unused',
    });
    const { config } = await import('../config');
    assert.equal(config.DEEPSEEK_API_KEY, 'synthetic-only-key');
    assert.equal(loader.mock.calls.length, 0);
  } finally {
    loader.mock.restore();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const EVALUATION_URI = 'mongodb://127.0.0.1:27028/nwai_discovery_test_live_evaluation';
export class EvaluationSafetyError extends Error {
  constructor(readonly code: string) { super(code); }
}
function requireSafe(value: unknown, code: string): asserts value {
  if (!value) throw new EvaluationSafetyError(code);
}
const limits = {
  NOTE_DISCOVERY_MAX_MODEL_CALLS: 3, NOTE_DISCOVERY_MAX_TOOL_CALLS: 8, NOTE_DISCOVERY_MAX_NOTES_READ: 12,
  NOTE_DISCOVERY_MAX_INPUT_TOKENS: 24000, NOTE_DISCOVERY_MAX_OUTPUT_TOKENS: 4000, NOTE_DISCOVERY_TIMEOUT_MS: 90000,
};
const pricing = ['NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION', 'NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION',
  'NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION'] as const;
const caps = ['NOTE_DISCOVERY_USER_DAILY_CNY', 'NOTE_DISCOVERY_GLOBAL_DAILY_CNY', 'NOTE_DISCOVERY_RUN_RESERVATION_CNY'] as const;
export function evaluationPreflight(env: NodeJS.ProcessEnv) {
  requireSafe(env.NOTE_DISCOVERY_EVAL_ALLOW_PAID === 'yes', 'EVAL_PAID_OPT_IN_REQUIRED');
  requireSafe(env.NOTE_DISCOVERY_TEST_MONGO_URI === EVALUATION_URI, 'EVAL_FIXED_DATABASE_REQUIRED');
  requireSafe(env.DEEPSEEK_API_KEY?.trim(), 'EVAL_EXPLICIT_KEY_REQUIRED');
  requireSafe(env.NOTE_DISCOVERY_ENABLED === 'true', 'EVAL_EXPLICIT_ENABLE_REQUIRED');
  requireSafe(['deepseek-flash', 'deepseek-v4-pro'].includes(env.NOTE_DISCOVERY_MODEL ?? '')
    && env.NOTE_DISCOVERY_PRICED_MODEL === env.NOTE_DISCOVERY_MODEL, 'EVAL_EXPLICIT_MODEL_REQUIRED');
  requireSafe(['openrouter', 'dashscope'].includes(env.EMBEDDING_PROVIDER ?? '') && env.EMBEDDING_MODEL?.trim()
    && env.NOTE_DISCOVERY_PRICED_EMBEDDING_PROVIDER === env.EMBEDDING_PROVIDER
    && env.NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL === env.EMBEDDING_MODEL, 'EVAL_EXPLICIT_EMBEDDING_REQUIRED');
  const maxMicros = Number(env.NOTE_DISCOVERY_EVAL_MAX_CNY_MICROS);
  requireSafe(Number.isSafeInteger(maxMicros) && maxMicros > 0 && maxMicros <= 2100000, 'EVAL_CAP_INVALID');
  const settings: Record<string, string | number> = {};
  for (const key of pricing) {
    requireSafe(/^\d+(?:\.\d{1,12})?$/.test(env[key] ?? '') && Number.isFinite(Number(env[key])), 'EVAL_EXPLICIT_PRICE_REQUIRED');
    settings[key] = Number(env[key]);
  }
  for (const key of caps) {
    const value = env[key] ?? '';
    requireSafe(/^\d+(?:\.\d{1,6})?$/.test(value), 'EVAL_EXPLICIT_CAP_REQUIRED');
    const [whole, fraction = ''] = value.split('.');
    const micros = Number(whole + fraction.padEnd(6, '0'));
    requireSafe(Number.isSafeInteger(micros) && micros > 0 && micros <= maxMicros, 'EVAL_CAP_INVALID');
    settings[key] = micros;
  }
  for (const [key, maximum] of Object.entries(limits)) {
    const value = env[key] === undefined ? maximum : Number(env[key]);
    requireSafe(Number.isSafeInteger(value) && value > 0 && value <= maximum, 'EVAL_LIMIT_INVALID');
    settings[key] = value;
  }
  requireSafe(/^\d{4}-\d{2}-\d{2}$/.test(env.NOTE_DISCOVERY_EVAL_PRICE_VERIFIED_AT ?? '')
    && !!env.NOTE_DISCOVERY_EVAL_APPROVAL_ID?.trim(), 'EVAL_APPROVAL_METADATA_REQUIRED');
  return { maxMicros, metadata: {
    protocolVersion: 1, capMicros: maxMicros, approvalId: env.NOTE_DISCOVERY_EVAL_APPROVAL_ID!,
    pricesVerifiedAt: env.NOTE_DISCOVERY_EVAL_PRICE_VERIFIED_AT!,
    model: env.NOTE_DISCOVERY_MODEL!, embeddingProvider: env.EMBEDDING_PROVIDER!, embeddingModel: env.EMBEDDING_MODEL!,
    keyFingerprint: createHash('sha256').update(env.DEEPSEEK_API_KEY!).digest('hex'), settings,
  } };
}
export function assertEvaluationBinding(actual: unknown, expected: unknown) {
  requireSafe(isDeepStrictEqual(actual, expected), 'EVAL_APPROVAL_CONFIGURATION_CHANGED');
}
export interface EvaluationLedger {
  blockedAt?: unknown; spentTotalMicros: number; reservedTotalMicros: number;
  reservations: Array<{ state: string; delivery?: string; outcome?: string; reservedMicros: number; settledMicros?: number }>;
}
export function assertEvaluationBatchSafe(ledgers: EvaluationLedger[], runs: Array<{ providerDeliveryUnknown?: boolean; failureCategory?: string }>) {
  requireSafe(!runs.some(row => row.providerDeliveryUnknown || row.failureCategory === 'usage_unknown'), 'EVAL_BATCH_DELIVERY_UNKNOWN');
  for (const row of ledgers) {
    requireSafe(!row.blockedAt, 'EVAL_BATCH_BLOCKED');
    requireSafe(row.reservedTotalMicros === 0 && row.reservations.every(item => item.state === 'settled'), 'EVAL_BATCH_UNSETTLED');
    requireSafe(row.reservations.every(item => item.delivery !== 'delivery_unknown' && item.outcome === 'known'), 'EVAL_BATCH_USAGE_UNKNOWN');
  }
}
export function evaluationSettlementSummary(ledgers: EvaluationLedger[]) {
  const reservations = ledgers.flatMap(row => row.reservations);
  return {
    spentMicros: ledgers.reduce((sum, row) => sum + row.spentTotalMicros, 0),
    reservedMicros: ledgers.reduce((sum, row) => sum + row.reservedTotalMicros, 0),
    blocked: ledgers.some(row => !!row.blockedAt),
    unsettledReservations: reservations.filter(row => row.state !== 'settled').length,
    unknownReservations: reservations.filter(row => row.delivery === 'delivery_unknown' || row.outcome === 'unknown').length,
  };
}

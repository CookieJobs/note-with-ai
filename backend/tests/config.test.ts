import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNoteDiscoveryAccountAllowed, parseConfig } from '../config';

const budget = {
  NOTE_DISCOVERY_USER_DAILY_CNY: '0.5',
  NOTE_DISCOVERY_GLOBAL_DAILY_CNY: '10',
  NOTE_DISCOVERY_RUN_RESERVATION_CNY: '0.25',
  NOTE_DISCOVERY_PRICED_MODEL: 'deepseek-flash',
  NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION: '2',
  NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION: '4',
  NOTE_DISCOVERY_PRICED_EMBEDDING_PROVIDER: 'openrouter',
  NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
  NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION: '0',
};

test('a local discovery account restriction permits only the selected account', () => {
  const owner = '507f1f77bcf86cd799439011';
  const restricted = parseConfig({ ...budget, NOTE_DISCOVERY_LOCAL_USER_ID: owner });
  assert.equal(isNoteDiscoveryAccountAllowed(owner, restricted), true);
  assert.equal(isNoteDiscoveryAccountAllowed('507f1f77bcf86cd799439012', restricted), false);
  assert.equal(isNoteDiscoveryAccountAllowed(owner, parseConfig({})), true);
  assert.throws(() => parseConfig({ NOTE_DISCOVERY_LOCAL_USER_ID: 'not-an-id' }));
  assert.throws(() => parseConfig({ NODE_ENV: 'test', NOTE_DISCOVERY_LOCAL_USER_ID: owner }), /only allowed in development/);
});

test('discovery stays disabled by default even with complete pricing and caps', () => {
  const config = parseConfig(budget);
  assert.equal(config.NOTE_DISCOVERY_ENABLED, false);
  assert.equal(config.NOTE_DISCOVERY_RUNNABLE, false);
});

test('discovery refuses to run with any missing monetary cap or selected-provider price', () => {
  for (const key of Object.keys(budget)) {
    const config = parseConfig({
      ...budget,
      NOTE_DISCOVERY_ENABLED: 'true',
      [key]: undefined,
    });
    assert.equal(config.NOTE_DISCOVERY_RUNNABLE, false, key);
  }
});

test('discovery treats blank prices as absent and allows explicitly priced free calls', () => {
  const environment = { ...budget, NOTE_DISCOVERY_ENABLED: 'true' };
  assert.equal(parseConfig(environment).NOTE_DISCOVERY_RUNNABLE, true);
  assert.equal(parseConfig({
    ...environment, NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION: ' ',
  }).NOTE_DISCOVERY_RUNNABLE, false);
});

test('discovery rejects malformed prices that JavaScript would coerce to zero', () => {
  for (const value of ['0x0', '-1e-400', '0e999']) {
    assert.throws(() => parseConfig({
      ...budget, NOTE_DISCOVERY_ENABLED: 'true', NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION: value,
    }), /Invalid environment variables/, value);
  }
});

test('discovery uses its own chat model and pricing configuration', () => {
  const environment = {
    ...budget,
    NOTE_DISCOVERY_ENABLED: 'true',
    DEEPSEEK_CHAT_INPUT_CNY_PER_MILLION: '2',
    DEEPSEEK_CHAT_OUTPUT_CNY_PER_MILLION: '4',
    OPENROUTER_EMBEDDING_CNY_PER_MILLION: '0',
  };
  assert.equal(parseConfig(environment).NOTE_DISCOVERY_MODEL, 'deepseek-flash');
  const alternate = parseConfig({
    ...environment,
    NOTE_DISCOVERY_MODEL: 'deepseek-alternate',
  });
  assert.equal(alternate.NOTE_DISCOVERY_MODEL, 'deepseek-alternate');
  assert.equal(alternate.NOTE_DISCOVERY_RUNNABLE, false);
  assert.equal(parseConfig({
    ...environment,
    NOTE_DISCOVERY_MODEL: 'deepseek-alternate',
    NOTE_DISCOVERY_PRICED_MODEL: 'deepseek-alternate',
  }).NOTE_DISCOVERY_RUNNABLE, true);
  assert.equal(parseConfig({
    ...environment, NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION: undefined,
  }).NOTE_DISCOVERY_RUNNABLE, false);
});

test('discovery rejects stale embedding prices after switching provider or model', () => {
  const environment = { ...budget, NOTE_DISCOVERY_ENABLED: 'true' };
  assert.equal(parseConfig({ ...environment, EMBEDDING_PROVIDER: 'dashscope' }).NOTE_DISCOVERY_RUNNABLE, false);
  assert.equal(parseConfig({ ...environment, EMBEDDING_MODEL: 'alternate' }).NOTE_DISCOVERY_RUNNABLE, false);
  assert.equal(parseConfig({
    ...environment,
    EMBEDDING_PROVIDER: 'dashscope',
    EMBEDDING_MODEL: 'alternate',
    NOTE_DISCOVERY_PRICED_EMBEDDING_PROVIDER: 'dashscope',
    NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL: 'alternate',
  }).NOTE_DISCOVERY_RUNNABLE, true);
});

test('blank embedding model labels do not identify a priced model', () => {
  assert.equal(parseConfig({
    ...budget,
    NOTE_DISCOVERY_ENABLED: 'true',
    EMBEDDING_MODEL: '',
    NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL: '',
  }).NOTE_DISCOVERY_RUNNABLE, false);
});

test('blank discovery monetary caps leave the feature non-runnable', () => {
  const environment = { ...budget, NOTE_DISCOVERY_ENABLED: 'true' };
  for (const key of [
    'NOTE_DISCOVERY_USER_DAILY_CNY', 'NOTE_DISCOVERY_GLOBAL_DAILY_CNY', 'NOTE_DISCOVERY_RUN_RESERVATION_CNY',
  ]) {
    assert.equal(parseConfig({ ...environment, [key]: ' ' }).NOTE_DISCOVERY_RUNNABLE, false, key);
  }
});

test('discovery parses decimal CNY caps exactly in safe integer micros', () => {
  const config = parseConfig({
    ...budget,
    NOTE_DISCOVERY_GLOBAL_DAILY_CNY: '9007199254.740991',
    NOTE_DISCOVERY_RUN_RESERVATION_CNY: '0.000249',
  });
  assert.equal(config.NOTE_DISCOVERY_USER_DAILY_CNY_MICROS, 500_000);
  assert.equal(config.NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS, Number.MAX_SAFE_INTEGER);
  assert.equal(config.NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS, 249);
  assert.throws(() => parseConfig({
    ...budget, NOTE_DISCOVERY_GLOBAL_DAILY_CNY: '9007199254.740992',
  }), /Invalid environment variables/);
});

test('discovery has the planned scheduling and execution defaults', () => {
  const config = parseConfig({});
  assert.deepEqual([
    config.NOTE_DISCOVERY_MAX_MODEL_CALLS, config.NOTE_DISCOVERY_MAX_TOOL_CALLS,
    config.NOTE_DISCOVERY_MAX_NOTES_READ, config.NOTE_DISCOVERY_MAX_INPUT_TOKENS,
    config.NOTE_DISCOVERY_MAX_OUTPUT_TOKENS, config.NOTE_DISCOVERY_TIMEOUT_MS,
    config.NOTE_DISCOVERY_AUTO_DEBOUNCE_MS, config.NOTE_DISCOVERY_AUTO_DAILY_LIMIT,
    config.NOTE_DISCOVERY_AUTO_HOURLY_LIMIT, config.NOTE_DISCOVERY_MANUAL_DAILY_LIMIT,
    config.NOTE_DISCOVERY_MANUAL_COOLDOWN_MS, config.NOTE_DISCOVERY_DAILY_EXPOSURE_LIMIT,
  ], [3, 8, 12, 24000, 4000, 90000, 120000, 6, 2, 3, 60000, 3]);
});

test('discovery config rejects invalid flags, monetary caps and values above execution ceilings', () => {
  const invalid = {
    NOTE_DISCOVERY_ENABLED: 'yes',
    NOTE_DISCOVERY_RUN_RESERVATION_CNY: '0',
    NOTE_DISCOVERY_GLOBAL_DAILY_CNY: 'Infinity',
    NOTE_DISCOVERY_USER_DAILY_CNY: '0.0000001',
    NOTE_DISCOVERY_MAX_MODEL_CALLS: '4',
    NOTE_DISCOVERY_MAX_TOOL_CALLS: '9',
    NOTE_DISCOVERY_MAX_NOTES_READ: '13',
    NOTE_DISCOVERY_MAX_INPUT_TOKENS: '24001',
    NOTE_DISCOVERY_MAX_OUTPUT_TOKENS: '4001',
    NOTE_DISCOVERY_TIMEOUT_MS: '90001',
    NOTE_DISCOVERY_AUTO_DAILY_LIMIT: '1.5',
  };
  for (const [key, value] of Object.entries(invalid)) {
    assert.throws(() => parseConfig({ [key]: value }), /Invalid environment variables/, key);
  }
});

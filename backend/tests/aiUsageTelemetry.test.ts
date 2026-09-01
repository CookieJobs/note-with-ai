import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

const forbiddenKeys = new Set([
  'messages', 'content', 'prompt', 'response', 'body', 'email', 'providerPayload', 'rawPayload',
]);

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `saved telemetry must not contain ${key}`);
      assertNoForbiddenKeys(nested);
    }
  }
}

describe('AiUsageService', () => {
  afterEach(() => mock.restoreAll());

  it('writes one content-free succeeded event with provider usage and micro-CNY cost', async () => {
    const { AiUsageEvent } = require('../models/AiUsageEvent') as typeof import('../models/AiUsageEvent');
    const { AiUsageService } = require('../services/aiUsageService') as typeof import('../services/aiUsageService');
    const saved: Record<string, unknown>[] = [];
    mock.method(AiUsageEvent, 'create', async (event: Record<string, unknown>) => {
      saved.push(event);
      return event as any;
    });

    const service = new AiUsageService(() => true);
    const reply = await service.run(
      { requestId: 'req-1', userId: 'user-1', operation: 'chat' },
      { provider: 'deepseek', model: 'deepseek-chat', inputPriceCnyPerMillion: 2, outputPriceCnyPerMillion: 8 },
      async () => ({ value: 'answer', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } }),
    );

    assert.equal(reply, 'answer');
    assert.equal(saved.length, 1);
    const event = saved[0];
    assert.deepEqual({
      requestId: event.requestId, provider: event.provider, model: event.model,
      operation: event.operation, status: event.status, inputTokens: event.inputTokens,
      outputTokens: event.outputTokens, totalTokens: event.totalTokens, currency: event.currency,
    }, {
      requestId: 'req-1', provider: 'deepseek', model: 'deepseek-chat', operation: 'chat',
      status: 'succeeded', inputTokens: 12, outputTokens: 8, totalTokens: 20, currency: 'CNY',
    });
    assert.equal(event.estimatedCostMicros, 88);
    assert.equal(typeof event.durationMs, 'number');
    assert.ok(event.startedAt instanceof Date);
    assert.ok(event.finishedAt instanceof Date);
    assertNoForbiddenKeys(event);
  });

  it('records null usage and cost when the provider does not return usage or price', async () => {
    const { AiUsageEvent } = require('../models/AiUsageEvent') as typeof import('../models/AiUsageEvent');
    const { AiUsageService } = require('../services/aiUsageService') as typeof import('../services/aiUsageService');
    const saved: Record<string, unknown>[] = [];
    mock.method(AiUsageEvent, 'create', async (event: Record<string, unknown>) => (saved.push(event), event as any));

    await new AiUsageService(() => true).run(
      { requestId: 'req-no-usage', operation: 'note_meta' },
      { provider: 'deepseek', model: 'deepseek-chat' },
      async () => ({ value: null }),
    );

    assert.deepEqual(
      [saved[0].inputTokens, saved[0].outputTokens, saved[0].totalTokens, saved[0].estimatedCostMicros],
      [null, null, null, null],
    );
  });

  it('normalizes provider failures without persisting their raw message', async () => {
    const { AiUsageEvent } = require('../models/AiUsageEvent') as typeof import('../models/AiUsageEvent');
    const { AiUsageService } = require('../services/aiUsageService') as typeof import('../services/aiUsageService');
    const saved: Record<string, unknown>[] = [];
    mock.method(AiUsageEvent, 'create', async (event: Record<string, unknown>) => (saved.push(event), event as any));

    await assert.rejects(
      () => new AiUsageService(() => true).run(
        { requestId: 'req-failed', operation: 'rerank' },
        { provider: 'deepseek', model: 'deepseek-chat' },
        async () => { const error = new Error('prompt: secret note body'); (error as any).code = 'ECONNRESET'; throw error; },
      ),
      /secret note body/,
    );

    assert.equal(saved[0].status, 'failed');
    assert.equal(saved[0].errorCode, 'ECONNRESET');
    assert.equal(JSON.stringify(saved[0]).includes('secret note body'), false);
    assertNoForbiddenKeys(saved[0]);
  });

  it('finalizes streaming usage once and marks an unfinished stream aborted', async () => {
    const { AiUsageEvent } = require('../models/AiUsageEvent') as typeof import('../models/AiUsageEvent');
    const { AiUsageService } = require('../services/aiUsageService') as typeof import('../services/aiUsageService');
    const saved: Record<string, unknown>[] = [];
    mock.method(AiUsageEvent, 'create', async (event: Record<string, unknown>) => (saved.push(event), event as any));
    const service = new AiUsageService(() => true);
    const recorder = service.createStreamingRecorder(
      { requestId: 'req-stream', operation: 'chat' },
      { provider: 'deepseek', model: 'deepseek-chat' },
    );
    await recorder.succeeded({ inputTokens: 3, outputTokens: 5, totalTokens: 8 });
    await recorder.aborted();

    const aborted = service.createStreamingRecorder(
      { requestId: 'req-aborted', operation: 'chat' },
      { provider: 'deepseek', model: 'deepseek-chat' },
    );
    await aborted.aborted();

    assert.equal(saved.length, 2);
    assert.deepEqual([saved[0].status, saved[0].totalTokens], ['succeeded', 8]);
    assert.deepEqual([saved[1].status, saved[1].inputTokens, saved[1].estimatedCostMicros], ['aborted', null, null]);
  });

  it('uses the unique request ID constraint to retain only one terminal event', async () => {
    const { AiUsageEvent } = require('../models/AiUsageEvent') as typeof import('../models/AiUsageEvent');
    const { AiUsageService } = require('../services/aiUsageService') as typeof import('../services/aiUsageService');
    const saved: Record<string, unknown>[] = [];
    mock.method(AiUsageEvent, 'create', async (event: Record<string, unknown>) => {
      if (saved.some((savedEvent) => savedEvent.requestId === event.requestId)) {
        const duplicate = new Error('duplicate') as Error & { code?: number };
        duplicate.code = 11000;
        throw duplicate;
      }
      saved.push(event);
      return event as any;
    });
    const service = new AiUsageService(() => true);
    const recorder = service.createStreamingRecorder(
      { requestId: 'req-unique', operation: 'embedding' },
      { provider: 'openrouter', model: 'embedding-model' },
    );

    await recorder.succeeded();
    await service.createStreamingRecorder(
      { requestId: 'req-unique', operation: 'embedding' },
      { provider: 'openrouter', model: 'embedding-model' },
    ).succeeded();

    assert.equal(saved.length, 1);
  });
});

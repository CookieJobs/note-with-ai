import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { DeepSeekApiClient } from '../utils/apiClient';
import { aiUsageService } from '../services/aiUsageService';
import { logger } from '../utils/logger';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

const originalFetch = globalThis.fetch;

function sseResponse(chunks: string[], options: { keepOpen?: boolean } = {}): Response {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index++]));
      } else if (!options.keepOpen) {
        controller.close();
      }
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let answer = '';
  for await (const chunk of stream) answer += chunk;
  return answer;
}

async function resolvesWithinFakeTime<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  const timeoutMarker = Symbol('timed out');
  const timeout = new Promise<typeof timeoutMarker>((resolve) => {
    setTimeout(() => resolve(timeoutMarker), timeoutMs);
  });
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await mock.timers.tick(timeoutMs);
  const result = await Promise.race([promise, timeout]);
  return result === timeoutMarker ? undefined : result;
}

async function rejectsWithinFakeTime(promise: Promise<unknown>, advanceMs: number): Promise<unknown> {
  const pendingMarker = Symbol('still pending');
  const settled = promise.then(
    (value) => ({ kind: 'resolved' as const, value }),
    (error: unknown) => ({ kind: 'rejected' as const, error }),
  );
  const pending = new Promise<typeof pendingMarker>((resolve) => {
    setTimeout(() => resolve(pendingMarker), advanceMs + 100);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await mock.timers.tick(advanceMs);
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await mock.timers.tick(500);
  }
  return Promise.race([settled, pending]);
}

afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

describe('DeepSeek streaming completion', () => {
  it('processes the final SSE data frame when EOF follows without a newline', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    globalThis.fetch = (async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
      'data: [DONE]',
    ])) as typeof fetch;

    const result = await resolvesWithinFakeTime(
      collect(new DeepSeekApiClient('test-key').chatCompletionStream([])), 100,
    );
    assert.equal(result, 'answer');
  });

  it('rejects an EOF that arrives before a provider terminal marker', async () => {
    globalThis.fetch = (async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    ])) as typeof fetch;

    await assert.rejects(
      () => collect(new DeepSeekApiClient('test-key').chatCompletionStream([])),
      (error: unknown) => error instanceof Error && /流|结束|完成|中断/.test(error.message),
    );
  });

  it('stops reading as soon as finish_reason is stop even if the provider leaves the connection open', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    globalThis.fetch = (async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    ], { keepOpen: true })) as typeof fetch;

    const result = await resolvesWithinFakeTime(
      collect(new DeepSeekApiClient('test-key').chatCompletionStream([])), 100,
    );
    assert.equal(result, 'answer');
  });

  it('treats finish_reason length as a visible terminal condition', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    globalThis.fetch = (async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"bounded answer"},"finish_reason":"length"}]}\n\n',
    ], { keepOpen: true })) as typeof fetch;

    const result = await resolvesWithinFakeTime(
      collect(new DeepSeekApiClient('test-key').chatCompletionStream([])), 100,
    );
    assert.equal(result, 'bounded answer');
  });

  it('surfaces provider error frames instead of treating them as ignored data', async () => {
    globalThis.fetch = (async () => sseResponse([
      'data: {"error":{"message":"private provider diagnostic"}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch;

    await assert.rejects(
      () => collect(new DeepSeekApiClient('test-key').chatCompletionStream([])),
      (error: unknown) => error instanceof Error
        && /DeepSeek|服务|请求|错误|失败|流/.test(error.message)
        && !error.message.includes('private provider diagnostic'),
    );
  });

  it('times out while waiting for the initial response even when fetch ignores abort', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;

    const outcome = await rejectsWithinFakeTime(
      collect(new DeepSeekApiClient('test-key').chatCompletionStream([])), 45_000,
    ) as { kind: string; error?: Error & { details?: Record<string, unknown> } };
    assert.equal(outcome.kind, 'rejected');
    const error = outcome.error!;
    assert.equal(error.details?.code, 'AI_PROVIDER_TIMEOUT');
    assert.equal(error.message.includes('test-key'), false);
  });

  it('times out an idle reader even when its read and cancel ignore abort', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
      pull() { return new Promise<void>(() => undefined); },
      cancel() { return new Promise<void>(() => undefined); },
    }), { status: 200 })) as typeof fetch;

    const outcome = await rejectsWithinFakeTime(
      collect(new DeepSeekApiClient('test-key').chatCompletionStream([])), 45_000,
    ) as { kind: string; error?: Error & { details?: Record<string, unknown> } };
    assert.equal(outcome.kind, 'rejected');
    const error = outcome.error!;
    assert.equal(error.details?.code, 'AI_PROVIDER_TIMEOUT');
    assert.equal(error.message.includes('test-key'), false);
  });

  it('enforces the total deadline when keepalive frames prevent the idle deadline', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let readCount = 0;
    globalThis.fetch = (async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: () => {
            readCount++;
            return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => setTimeout(() => {
              resolve({ done: false, value: new TextEncoder().encode(': keepalive\n\n') });
            }, 40_000));
          },
          cancel: () => new Promise<void>(() => undefined),
          releaseLock() {},
        }),
      },
    } as unknown as Response)) as typeof fetch;

    const result = collect(new DeepSeekApiClient('test-key').chatCompletionStream([]));
    const handled = result.then((value) => ({ value }), (error: unknown) => ({ error }));
    const pending = new Promise<symbol>((resolve) => setTimeout(() => resolve(Symbol('still pending')), 121_000));
    for (let interval = 0; interval < 3; interval++) {
      for (let i = 0; i < 5 && readCount < interval + 1; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.equal(readCount, interval + 1);
      await mock.timers.tick(40_000);
      for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await mock.timers.tick(500);
    }
    const outcome = await Promise.race([handled, pending]);
    assert.notEqual(typeof outcome, 'symbol');
    assert.equal(typeof outcome === 'symbol' ? false : 'error' in outcome, true);
    assert.equal((outcome as { error: Error & { details?: Record<string, unknown> } }).error.details?.code, 'AI_PROVIDER_TIMEOUT');
  });

  it('gives a safe retry hint for HTTP 429 without exposing the provider body', async () => {
    globalThis.fetch = (async () => new Response('secret provider response', { status: 429 })) as typeof fetch;

    await assert.rejects(
      () => collect(new DeepSeekApiClient('test-key').chatCompletionStream([])),
      (error: unknown) => error instanceof Error
        && error.message.includes('稍后重试')
        && (error as Error & { details?: Record<string, unknown> }).details?.code === 'AI_PROVIDER_RATE_LIMITED'
        && !error.message.includes('secret provider response'),
    );
  });

  it('returns a safe configuration hint for HTTP 401 without exposing the provider body', async () => {
    globalThis.fetch = (async () => new Response('secret credential diagnostic', { status: 401 })) as typeof fetch;

    await assert.rejects(
      () => collect(new DeepSeekApiClient('test-key').chatCompletionStream([])),
      (error: unknown) => error instanceof Error
        && error.message.includes('认证失败')
        && (error as Error & { details?: Record<string, unknown> }).details?.code === 'AI_PROVIDER_AUTHENTICATION_FAILED'
        && !error.message.includes('secret credential diagnostic'),
    );
  });

  it('logs only a whitelisted fetch cause code for network failures', async () => {
    const logs: string[] = [];
    mock.method(logger, 'warn', (message: unknown) => { logs.push(String(message)); return logger; });
    const cause = Object.assign(new Error('private socket diagnostic'), { code: 'UND_ERR_SOCKET' });
    const networkError = Object.assign(new Error('private response and credential'), { cause });
    globalThis.fetch = (() => Promise.reject(networkError)) as typeof fetch;

    await assert.rejects(
      () => collect(new DeepSeekApiClient('test-key').chatCompletionStream([])),
      (error: unknown) => error instanceof Error
        && (error as Error & { details?: Record<string, unknown> }).details?.networkCode === 'UND_ERR_SOCKET'
        && !error.message.includes('private'),
    );
    const safeLog = logs.filter((message) => message.startsWith('{'))
      .map((message) => JSON.parse(message)).find((message) => message.networkCode);
    assert.equal(safeLog?.networkCode, 'UND_ERR_SOCKET');
    assert.equal(logs.join('\n').includes('private'), false);
  });

  it('bounds cancellation when a successful provider reader never settles cancel', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let cancelStarted = false;
    globalThis.fetch = (async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new TextEncoder().encode('data: [DONE]\n\n') }),
          cancel: () => { cancelStarted = true; return new Promise<void>(() => undefined); },
          releaseLock() {},
        }),
      },
    } as unknown as Response)) as typeof fetch;

    const result = collect(new DeepSeekApiClient('test-key').chatCompletionStream([]));
    const handled = result.then((value) => ({ value }), (error: unknown) => ({ error }));
    for (let i = 0; i < 10 && !cancelStarted; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(cancelStarted, true);
    await mock.timers.tick(500);
    assert.deepEqual(await handled, { value: '' });
  });

  it('does not wait for a telemetry recorder that never settles after a completed stream', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let telemetryStarted = false;
    mock.method(aiUsageService, 'createStreamingRecorder', () => ({
      succeeded: () => { telemetryStarted = true; return new Promise<void>(() => undefined); },
      failed: () => new Promise<void>(() => undefined),
      aborted: () => new Promise<void>(() => undefined),
    } as never));
    globalThis.fetch = (async () => sseResponse(['data: [DONE]\n\n'])) as typeof fetch;

    const result = collect(new DeepSeekApiClient('test-key').chatCompletionStream([]));
    const handled = result.then((value) => ({ value }), (error: unknown) => ({ error }));
    for (let i = 0; i < 10 && !telemetryStarted; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(telemetryStarted, true);
    await mock.timers.tick(500);
    assert.deepEqual(await handled, { value: '' });
  });
});

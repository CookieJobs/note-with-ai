import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { NextFunction } from 'express';
import performanceRouter from '../routes/performance';
import recommendRouter, { getRecommendationTaskResult } from '../routes/recommend';
import { Note } from '../models/Note';
import { globalErrorHandler } from '../utils/errorHandler';
import { ResourceValidator, UserValidator } from '../utils/userValidation';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

type CapturedResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => CapturedResponse;
  json: (body: unknown) => CapturedResponse;
};

function makeResponse(): CapturedResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

function findRouteHandler(router: { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> }, path: string) {
  const layer = router.stack.find((entry) => entry.route?.path === path);
  assert.ok(layer?.route, `missing route ${path}`);
  const handler = layer.route.stack[layer.route.stack.length - 1]?.handle;
  assert.ok(handler, `missing handler for ${path}`);
  return handler;
}

async function invokeRoute(handler: Function, request: Record<string, unknown>, response: CapturedResponse) {
  let capturedError: unknown;
  handler(request, response, (error?: unknown) => {
    capturedError = error;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return capturedError;
}

describe('recommend and performance route contracts', () => {
  afterEach(() => mock.restoreAll());

  it('passes the canonical source revision into the enrichment worker CAS lookup', async () => {
    const handler = findRouteHandler(recommendRouter as never, '/semantic-notes');
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(ResourceValidator, 'validateOwnership', async () => ({ userId: { toString: () => 'user-1' } }) as never);
    const filters: unknown[] = [];
    mock.method(Note, 'findOne', (filter: unknown) => {
      filters.push(filter);
      if (filters.length === 1) {
        return { select: async () => ({ revision: 7 }) } as never;
      }
      return null as never;
    });

    const response = makeResponse();
    const error = await invokeRoute(handler, { body: { noteId: 'note-1' } }, response);

    assert.ok(error);
    globalErrorHandler(error as never, { method: 'POST', path: '/semantic-notes' } as never, response as never, (() => undefined) as NextFunction);
    assert.equal(filters.length, 2);
    assert.deepEqual(filters[1], { _id: 'note-1', userId: 'user-1', revision: 7 });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      success: false,
      error: '笔记已被更新，请重试',
      message: '笔记已被更新，请重试',
      type: 'EXTERNAL_API_ERROR',
    });
  });

  it('returns not found when the canonical source disappears before scheduling enrichment', async () => {
    const handler = findRouteHandler(recommendRouter as never, '/semantic-notes');
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(ResourceValidator, 'validateOwnership', async () => ({ userId: { toString: () => 'user-1' } }) as never);
    mock.method(Note, 'findOne', () => ({ select: async () => null }) as never);

    const response = makeResponse();
    const error = await invokeRoute(handler, { body: { noteId: 'note-1' } }, response);
    assert.ok(error);
    globalErrorHandler(error as never, { method: 'POST', path: '/semantic-notes' } as never, response as never, (() => undefined) as NextFunction);

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {
      success: false,
      error: '笔记不存在或无权限',
      message: '笔记不存在或无权限',
      type: 'NOT_FOUND_ERROR',
    });
  });

  it('maps a stale worker status to a retryable error even after a stale callback result', () => {
    const response = makeResponse();
    let error: unknown;
    try {
      getRecommendationTaskResult('stale', {
        recommendations: [],
        meta: { diagnostics: { stage: 'context', reason: 'stale_source_revision' } },
        message: 'stale source',
      } as never);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    globalErrorHandler(error as never, { method: 'POST', path: '/semantic-notes' } as never, response as never, (() => undefined) as NextFunction);

    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      success: false,
      error: '笔记已被更新，请重试',
      message: '笔记已被更新，请重试',
      type: 'EXTERNAL_API_ERROR',
    });
  });

  it('rejects an ambiguous performance operation route parameter before looking up metrics', async () => {
    const handler = findRouteHandler(performanceRouter as never, '/stats/:operationName');
    const response = makeResponse();
    const error = await invokeRoute(handler, { params: { operationName: ['first', 'second'] } }, response);
    assert.ok(error);
    globalErrorHandler(error as never, { method: 'GET', path: '/stats/first' } as never, response as never, (() => undefined) as NextFunction);

    assert.equal(response.statusCode, 400);
    assert.equal((response.body as { type: string }).type, 'VALIDATION_ERROR');
  });

  it('exposes an authenticated relationship feedback route inside the recommend domain', () => {
    const handler = findRouteHandler(recommendRouter as never, '/relationships/:relationshipId/feedback');
    assert.equal(typeof handler, 'function');
  });
});

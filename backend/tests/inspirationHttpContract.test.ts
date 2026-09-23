import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { NextFunction } from 'express';
import inspirationRouter from '../routes/inspirations';
import { inspirationService } from '../services/inspirationService';
import { inspirationError, type InspirationDto } from '../services/inspirationTypes';
import { authenticateToken } from '../middleware/auth';
import { globalErrorHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';

type CapturedResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => CapturedResponse;
  json: (body: unknown) => CapturedResponse;
  setHeader: (name: string, value: string) => CapturedResponse;
};

function makeResponse(): CapturedResponse {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
  };
}

function routeStack(path: string, method: 'get' | 'post') {
  const layer = (inspirationRouter as never as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
    .find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer?.route, `missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack;
}

function routeHandler(path: string, method: 'get' | 'post') {
  const handlers = routeStack(path, method);
  return handlers[handlers.length - 1].handle;
}

async function invokeRoute(handler: Function, request: Record<string, unknown>, response: CapturedResponse) {
  let capturedError: unknown;
  handler(request, response, (error?: unknown) => { capturedError = error; });
  await new Promise((resolve) => setImmediate(resolve));
  return capturedError;
}

const item: InspirationDto = {
  id: 'inspiration-1', topicLabel: '知识管理', headline: '让记录更容易复用',
  brief: '分类方法值得尝试【1】。', whyRelevant: '关联近期整理笔记。', nextQuestion: '先整理哪类记录？',
  sources: [{ sourceId: '1', canonicalUrl: 'https://example.com/a', title: '来源', publisher: 'example.com', snippet: '摘要', retrievedAt: '2026-09-22T00:00:00.000Z' }],
  createdAt: '2026-09-22T00:00:01.000Z',
};

describe('P15 inspiration HTTP contract', () => {
  afterEach(() => mock.restoreAll());

  it('requires authentication as the first middleware for POST and GET', () => {
    for (const [path, method] of [['/', 'post'], ['/latest', 'get']] as const) {
      assert.equal(routeStack(path, method)[0].handle, authenticateToken);
    }
  });

  it('wraps a completed research result in the standard data envelope', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(inspirationService, 'request', async (userId: string) => {
      assert.equal(userId, 'user-1');
      return { status: 'created', item };
    });
    const response = makeResponse();
    const error = await invokeRoute(routeHandler('/', 'post'), { body: { query: 'must be ignored', noteId: 'must be ignored' } }, response);
    assert.equal(error, undefined);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(response.body, { success: true, message: '研究灵感已生成', data: { status: 'created', item } });
  });

  it('returns an explicit no-result envelope without accepting browser search input', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(inspirationService, 'request', async (...args: unknown[]) => {
      assert.deepEqual(args, ['user-1']);
      return { status: 'no_result' };
    });
    const response = makeResponse();
    const error = await invokeRoute(routeHandler('/', 'post'), { body: { query: 'unsafe client query' } }, response);
    assert.equal(error, undefined);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(response.body, { success: true, message: '这次没有找到新灵感', data: { status: 'no_result' } });
  });

  it('maps provider-unavailable errors to a stable sanitized HTTP envelope', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(inspirationService, 'request', async () => { throw inspirationError('SEARCH_PROVIDER_UNAVAILABLE', 503); });
    const response = makeResponse();
    const error = await invokeRoute(routeHandler('/', 'post'), {}, response);
    assert.ok(error);
    globalErrorHandler(error as never, { method: 'POST', path: '/api/inspirations' } as never, response as never, (() => undefined) as NextFunction);
    assert.equal(response.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(response.body), /query|content|summary/);
    assert.equal((response.body as { code: string }).code, 'SEARCH_PROVIDER_UNAVAILABLE');
  });

  it('returns null when there is no latest item and scopes lookup to the authenticated user', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-2' } }) as never);
    mock.method(inspirationService, 'latest', async (userId: string) => {
      assert.equal(userId, 'user-2');
      return null;
    });
    const response = makeResponse();
    const error = await invokeRoute(routeHandler('/latest', 'get'), {}, response);
    assert.equal(error, undefined);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(response.body, { success: true, message: '获取最新灵感成功', data: { item: null } });
  });

  it('preserves the in-progress error code but never returns query or note metadata', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(inspirationService, 'request', async () => { throw inspirationError('INSPIRATION_IN_PROGRESS', 409); });
    const response = makeResponse();
    const error = await invokeRoute(routeHandler('/', 'post'), {}, response);
    assert.ok(error);
    globalErrorHandler(error as never, { method: 'POST', path: '/api/inspirations' } as never, response as never, (() => undefined) as NextFunction);
    assert.equal(response.statusCode, 409);
    assert.equal((response.body as { code: string }).code, 'INSPIRATION_IN_PROGRESS');
    assert.doesNotMatch(JSON.stringify(response.body), /query|content|summary/);
  });
});

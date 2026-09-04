import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { NextFunction } from 'express';
import performanceRouter from '../routes/performance';
import recommendRouter, { getRecommendationTaskResult, toPublicRecommendationResult } from '../routes/recommend';
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
        return { select: () => ({ lean: async () => ({ revision: 7 }) }) } as never;
      }
      if (filters.length === 3) {
        return { select: () => ({ lean: async () => null }) } as never;
      }
      return null as never;
    });

    const response = makeResponse();
    const error = await invokeRoute(handler, { body: { noteId: 'note-1' } }, response);

    assert.ok(error);
    globalErrorHandler(error as never, { method: 'POST', path: '/semantic-notes' } as never, response as never, (() => undefined) as NextFunction);
    assert.equal(filters.length, 3);
    assert.deepEqual(filters[1], { _id: 'note-1', userId: 'user-1', revision: 7 });
    assert.deepEqual(filters[2], { _id: 'note-1', userId: 'user-1' });
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
    mock.method(Note, 'findOne', () => ({ select: () => ({ lean: async () => null }) }) as never);

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

  it('backfills a missing revision before running recommendation enrichment', async () => {
    const handler = findRouteHandler(recommendRouter as never, '/semantic-notes');
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(ResourceValidator, 'validateOwnership', async () => ({ userId: { toString: () => 'user-1' } }) as never);
    let legacyBackfilled = false;
    let initialRead = true;
    let usedLeanRead = false;
    const hydratedLegacy = Note.hydrate({
      _id: 'note-1', userId: 'user-1', content: '正文', contentText: '正文', title: '标题',
      summary: '', concepts: [], updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    });
    const source = {
      _id: 'note-1', userId: 'user-1', content: '正文', contentText: '正文', title: '标题',
      summary: '', concepts: [], revision: undefined, updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    };
    assert.equal(hydratedLegacy.revision, 1, 'Mongoose hydration applies the schema default to legacy documents');
    mock.method(Note, 'findOne', (filter: Record<string, unknown>) => {
      if (filter.revision === 1) return legacyBackfilled ? { ...source, revision: 1 } : null as never;
      if (initialRead) {
        initialRead = false;
        return {
          select: () => ({
            lean: async () => {
              usedLeanRead = true;
              return source;
            },
            then: (resolve: (value: typeof hydratedLegacy) => unknown) => resolve(hydratedLegacy),
          }),
        } as never;
      }
      return source as never;
    });
    mock.method(Note, 'find', () => ({
      select() { return this; },
      lean: async () => [],
    }) as never);
    const backfills: unknown[] = [];
    mock.method(Note, 'updateOne', async (...args: unknown[]) => {
      backfills.push(args);
      legacyBackfilled = true;
      return { matchedCount: 1 } as never;
    });

    const response = makeResponse();
    const error = await invokeRoute(handler, { body: { noteId: 'note-1' } }, response);

    assert.equal(error, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(usedLeanRead, true);
    assert.deepEqual(backfills[0], [
      { _id: 'note-1', userId: 'user-1', revision: { $exists: false } },
      { $set: { revision: 1 } },
      { timestamps: false },
    ]);
  });

  it('retries once on a recoverable revision drift instead of returning a 5xx', async () => {
    const handler = findRouteHandler(recommendRouter as never, '/semantic-notes');
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(ResourceValidator, 'validateOwnership', async () => ({ userId: { toString: () => 'user-1' } }) as never);
    const sourceReads: unknown[] = [];
    const currentNote = {
      _id: 'note-1', userId: 'user-1', revision: 8,
      content: '', contentText: '', title: '', summary: '', concepts: [],
      recommendCache: null, updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    };
    mock.method(Note, 'findOne', (filter: Record<string, unknown>) => {
      sourceReads.push(filter);
      if (filter.revision === 7) return null as never;
      if (filter.revision === 8) return currentNote as never;
      const revision = sourceReads.length === 1 ? 7 : 8;
      return {
        ...currentNote,
        revision,
        select: () => ({ lean: async () => ({ revision }) }),
      } as never;
    });
    mock.method(Note, 'updateOne', async () => ({ matchedCount: 1 }) as never);

    const response = makeResponse();
    const error = await invokeRoute(handler, { body: { noteId: 'note-1' } }, response);

    assert.equal(error, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as { success: boolean }).success, true);
    assert.deepEqual(sourceReads, [
      { _id: 'note-1', userId: 'user-1' },
      { _id: 'note-1', userId: 'user-1', revision: 7 },
      { _id: 'note-1', userId: 'user-1' },
      { _id: 'note-1', userId: 'user-1', revision: 8 },
      { _id: 'note-1', userId: 'user-1' },
    ]);
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

  it('returns the relationship DTO without numeric diagnostics when the candidate list is empty', async () => {
    const data = toPublicRecommendationResult({
        sourceNoteId: 'note-1',
        sourceRevision: 4,
        status: 'ready',
        relationships: [],
        generatedAt: '2026-09-02T00:00:00.000Z',
        recommendations: [],
        meta: { diagnostics: { stage: 'rerank', reason: 'all_candidates_below_hard_threshold' } },
      } as never);
    assert.deepEqual(data, {
      sourceNoteId: 'note-1', sourceRevision: 4, status: 'ready', relationships: [], generatedAt: '2026-09-02T00:00:00.000Z',
    });
  });

  it('uses the same relationship DTO for a low-threshold empty result', async () => {
    const data = toPublicRecommendationResult({
        sourceNoteId: 'note-2',
        sourceRevision: 5,
        status: 'insufficient_history',
        relationships: [],
        generatedAt: '2026-09-02T00:01:00.000Z',
        recommendations: [],
        meta: { diagnostics: { stage: 'recall', reason: 'all_candidates_below_s1_threshold', bestS1Score: 0.2 } },
      } as never);
    assert.deepEqual(data, {
      sourceNoteId: 'note-2',
      sourceRevision: 5,
      status: 'insufficient_history',
      relationships: [],
      generatedAt: '2026-09-02T00:01:00.000Z',
    });
    assert.equal('meta' in data, false);
    assert.equal('recommendations' in data, false);
  });
});

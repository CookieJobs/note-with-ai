import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

const restores: Array<() => void> = [];

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  restores.push(() => { (target as any)[key] = original; });
}

afterEach(() => {
  mock.restoreAll();
  while (restores.length) restores.pop()?.();
});

describe('first-party product events', () => {
  it('only accepts allowlisted server events with their strict property schema', async () => {
    const { ProductEventService } = require('../services/productEventService');
    const ProductEvent = require('../models/ProductEvent').default;
    const saved: Array<Record<string, unknown>> = [];
    replaceMethod(ProductEvent, 'create', (async (input: Record<string, unknown>) => {
      saved.push(input);
    }) as never);

    await ProductEventService.trackProductEvent({
      name: 'note_created', userId: 'user-1', source: 'server', properties: {},
      occurredAt: new Date('2026-08-31T16:30:00.000Z'),
    });
    assert.equal(saved[0].name, 'note_created');
    assert.equal(saved[0].dayKey, '2026-09-01');
    await assert.rejects(() => ProductEventService.trackProductEvent({
      name: 'note_created', userId: 'user-1', source: 'server', properties: { content: 'private' },
    }), /无效|非法|Unrecognized/);
  });

  it('rejects arbitrary and overlong browser event properties', async () => {
    const { ProductEventService } = require('../services/productEventService');
    await assert.rejects(
      () => ProductEventService.recordWebEvent('user-1', 'note_created' as never, {}),
      /不允许上报/,
    );
    await assert.rejects(
      () => ProductEventService.recordWebEvent('user-1', 'association_opened', { surface: 'notes', extra: 'no' }),
      /无效|非法|Unrecognized/,
    );
    await assert.rejects(
      () => ProductEventService.trackProductEvent({
        name: 'user_registered', userId: 'user-1', source: 'server', properties: { method: 'x'.repeat(101) },
      }),
      /100/,
    );
  });

  it('deduplicates active days with a Shanghai day key and a unique upsert', async () => {
    const { ProductEventService } = require('../services/productEventService');
    const ProductEvent = require('../models/ProductEvent').default;
    let call: Record<string, unknown> | undefined;
    replaceMethod(ProductEvent, 'updateOne', (async (filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>) => {
      call = { filter, update, options };
    }) as never);

    ProductEventService.trackActiveDay('user-1', new Date('2026-08-31T16:30:00.000Z'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(call?.filter, { name: 'user_active_day', userId: 'user-1', dayKey: '2026-09-01' });
    assert.deepEqual(call?.options, { upsert: true });
  });

  it('defines 400-day TTL and active-day uniqueness indexes', () => {
    const ProductEvent = require('../models/ProductEvent').default;
    const indexes = ProductEvent.schema.indexes();
    assert.ok(indexes.some(([keys, options]: any) => keys.occurredAt === 1 && options.expireAfterSeconds === 400 * 24 * 60 * 60));
    assert.ok(indexes.some(([keys, options]: any) => keys.name === 1 && keys.userId === 1 && keys.dayKey === 1 && options.unique));
  });

  it('logs only safe identifiers when best-effort telemetry fails', async () => {
    const { ProductEventService } = require('../services/productEventService');
    const { logger } = require('../utils/logger');
    const logs: unknown[][] = [];
    replaceMethod(ProductEventService, 'trackProductEvent', (async () => { throw Object.assign(new Error('db unavailable'), { code: 'DB_UNAVAILABLE' }); }) as never);
    replaceMethod(logger, 'warn', ((...args: unknown[]) => { logs.push(args); }) as never);

    ProductEventService.trackProductEventBestEffort({ name: 'note_created', userId: 'user-1', source: 'server', properties: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(logs[0], ['产品事件写入失败', { eventName: 'note_created', userId: 'user-1', errorCode: 'DB_UNAVAILABLE' }]);
  });

  it('rejects disabled users after token authentication in both user loaders', async () => {
    const { UserValidator } = require('../utils/userValidation');
    const User = require('../models/User').default;
    const ProductEvent = require('../models/ProductEvent').default;
    replaceMethod(User, 'findById', (() => ({
      _id: { toString: () => 'user-1' },
      isActive: false,
      select: async () => ({ _id: { toString: () => 'user-1' }, isActive: false }),
    })) as never);

    await assert.rejects(() => UserValidator.validateAndGetUser({ user: { userId: 'user-1' } } as never), /账号已被禁用/);
    await assert.rejects(() => UserValidator.authenticateUser({ user: { userId: 'user-1' } } as never), /账号已被禁用/);
  });

  it('records the active timestamp only after an active user is loaded', async () => {
    const { UserValidator } = require('../utils/userValidation');
    const User = require('../models/User').default;
    const ProductEvent = require('../models/ProductEvent').default;
    const userId = '507f1f77bcf86cd799439011';
    replaceMethod(User, 'findById', (() => ({
      _id: { toString: () => userId }, isActive: true,
      select: async () => ({ _id: { toString: () => userId }, isActive: true }),
    })) as never);
    const updates: unknown[][] = [];
    replaceMethod(User, 'updateOne', (async (...args: unknown[]) => { updates.push(args); }) as never);
    replaceMethod(ProductEvent, 'updateOne', (async () => undefined) as never);

    await UserValidator.validateAndGetUser({ user: { userId } } as never);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0][0], { _id: userId });
  });

  it('accepts only an authenticated association_opened browser event', async () => {
    const events = require('../routes/events').default;
    const { generateToken } = require('../utils/jwt');
    const { UserValidator } = require('../utils/userValidation');
    const { ProductEventService } = require('../services/productEventService');
    replaceMethod(UserValidator, 'validateAndGetUser', (async () => ({ _id: { toString: () => 'user-1' } })) as never);
    const received: unknown[] = [];
    replaceMethod(ProductEventService, 'recordWebEvent', (async (...args: unknown[]) => { received.push(args); }) as never);

    const app = express();
    app.use(express.json());
    app.use('/api/events', events);
    app.use(require('../utils/errorHandler').globalErrorHandler);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const token = generateToken({ userId: 'user-1', username: 'user', email: 'private@example.com' });
      const accepted = await fetch(`http://127.0.0.1:${port}/api/events`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'association_opened', properties: { surface: 'notes' } }),
      });
      assert.equal(accepted.status, 202);
      assert.deepEqual(received, [['user-1', 'association_opened', { surface: 'notes' }]]);

      const denied = await fetch(`http://127.0.0.1:${port}/api/events`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'note_created', properties: {} }),
      });
      assert.equal(denied.status, 400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

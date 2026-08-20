import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.QQ_EMAIL_USER = process.env.QQ_EMAIL_USER || 'test@example.com';
process.env.QQ_EMAIL_PASS = process.env.QQ_EMAIL_PASS || 'test-pass';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';

type MultiOperation =
  | { type: 'incr'; key: string }
  | { type: 'expire'; key: string; seconds: number };

class FakeRedis {
  private readonly values = new Map<string, number>();
  private readonly ttls = new Map<string, number>();
  private readonly listeners = new Map<string, Array<(error: Error) => void>>();

  seed(key: string, value: number, ttl: number): void {
    this.values.set(key, value);
    this.ttls.set(key, ttl);
  }

  read(key: string): number | undefined {
    return this.values.get(key);
  }

  ttlValue(key: string): number | undefined {
    return this.ttls.get(key);
  }

  multi() {
    const operations: MultiOperation[] = [];
    const self = this;

    return {
      incr(key: string) {
        operations.push({ type: 'incr', key });
        return this;
      },
      expire(key: string, seconds: number) {
        operations.push({ type: 'expire', key, seconds });
        return this;
      },
      async exec() {
        const results: Array<[null, number]> = [];
        for (const operation of operations) {
          if (operation.type === 'incr') {
            const nextValue = (self.values.get(operation.key) ?? 0) + 1;
            self.values.set(operation.key, nextValue);
            results.push([null, nextValue]);
            continue;
          }

          self.ttls.set(operation.key, operation.seconds);
          results.push([null, 1]);
        }
        return results;
      },
    };
  }

  async ttl(key: string): Promise<number> {
    return this.ttls.get(key) ?? -1;
  }

  async get(key: string): Promise<string | null> {
    const value = this.values.get(key);
    return value === undefined ? null : String(value);
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) removed += 1;
      this.ttls.delete(key);
    }
    return removed;
  }

  on(event: 'error', listener: (error: Error) => void): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  disconnect(): void {}
}

const { RateLimitService, __rateLimitServiceTestUtils } = require('../services/auth/RateLimitService') as typeof import('../services/auth/RateLimitService');

describe('RateLimitService login failure windows', () => {
  afterEach(() => {
    __rateLimitServiceTestUtils.reset();
  });

  it('达到邮箱失败阈值后，会在下一次登录前直接拒绝请求', async () => {
    const redis = new FakeRedis();
    const emailKey = 'ratelimit:login:email:test@example.com';
    redis.seed(emailKey, 5, 120);
    __rateLimitServiceTestUtils.setRedisFactory(() => redis as any);

    await assert.rejects(
      () => RateLimitService.assertLoginAllowed('test@example.com', '1.1.1.1'),
      (error: any) => {
        assert.equal(error.message, '登录尝试次数过多，账号已暂时锁定（120秒后重试）');
        return true;
      }
    );

    assert.equal(redis.read(emailKey), 5);
  });

  it('登录失败会累计邮箱与 IP 计数，成功后会清空失败窗口', async () => {
    const redis = new FakeRedis();
    __rateLimitServiceTestUtils.setRedisFactory(() => redis as any);

    await RateLimitService.recordLoginFailure('test@example.com', '1.1.1.1');

    assert.equal(redis.read('ratelimit:login:email:test@example.com'), 1);
    assert.equal(redis.read('ratelimit:login:ip:1.1.1.1'), 1);
    assert.equal(redis.ttlValue('ratelimit:login:email:test@example.com'), 300);
    assert.equal(redis.ttlValue('ratelimit:login:ip:1.1.1.1'), 300);

    await RateLimitService.clearLoginFailures('test@example.com', '1.1.1.1');

    assert.equal(redis.read('ratelimit:login:email:test@example.com'), undefined);
    assert.equal(redis.read('ratelimit:login:ip:1.1.1.1'), undefined);
  });

  it('Redis 不可用时会退回到内存限流，而不是直接放行', async () => {
    let attempts = 0;
    __rateLimitServiceTestUtils.setRedisFactory(() => ({
      on() {},
      disconnect() {},
      multi() {
        return {
          incr() {
            return this;
          },
          expire() {
            return this;
          },
          async exec() {
            attempts += 1;
            throw new Error('redis unavailable');
          },
        };
      },
      async ttl() {
        return -1;
      },
      async get() {
        throw new Error('redis unavailable');
      },
      async del() {
        throw new Error('redis unavailable');
      },
    }) as any);

    await RateLimitService.check('sendVerifyCode', {
      email: 'test@example.com',
      ip: '1.1.1.1',
    });

    await assert.rejects(
      () =>
        RateLimitService.check('sendVerifyCode', {
          email: 'test@example.com',
          ip: '1.1.1.1',
        }),
      (error: any) => {
        assert.match(error.message, /验证码发送过于频繁/);
        return true;
      }
    );

    assert.equal(attempts, 3);
  });
});

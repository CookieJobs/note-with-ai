import Redis from 'ioredis';
import crypto from 'crypto';
import { config } from '../../config';
import { AppError, ErrorHandler, ErrorType } from '../../utils/errorHandler';
import { logger } from '../../utils/logger';
import { AuthRequestContext } from './authContext';

type RedisClient = Pick<Redis, 'multi' | 'ttl' | 'del' | 'get'> & {
  on(event: 'error', listener: (error: Error) => void): unknown;
  disconnect(): void;
};

type FallbackCounter = {
  count: number;
  expiresAt: number;
};

export type AuthRateLimitAction =
  | 'sendVerifyCode'
  | 'register'
  | 'login'
  | 'resetPassword';

interface RateLimitRule {
  scope: 'email' | 'ip';
  maxAttempts: number;
  windowSeconds: number;
  errorMessage: string;
}

let redis: RedisClient | null = null;
function safeRateLimitKey(key: string): string { return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16); }
let redisFactory: (() => RedisClient) | null = null;
const fallbackCounters = new Map<string, FallbackCounter>();
const LOGIN_FAILURE_WINDOW_SECONDS = 300;
const LOGIN_EMAIL_FAILURE_LIMIT = 5;
const LOGIN_IP_FAILURE_LIMIT = 20;
const LOGIN_LOCKED_MESSAGE = '登录尝试次数过多，账号已暂时锁定';

function createRedisClient(): RedisClient {
  if (redisFactory) {
    return redisFactory();
  }

  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  });
}

function getRedis(): RedisClient {
  if (!redis) {
    redis = createRedisClient();
    redis.on('error', (error) => {
      logger.warn('Redis unavailable for auth rate limiting, using in-memory fallback', {
        error: error.message,
      });
    });
  }
  return redis;
}

function buildRules(action: AuthRateLimitAction): RateLimitRule[] {
  switch (action) {
    case 'sendVerifyCode':
      return [
        {
          scope: 'email',
          maxAttempts: 1,
          windowSeconds: 60,
          errorMessage: '验证码发送过于频繁',
        },
        {
          scope: 'ip',
          maxAttempts: 10,
          windowSeconds: 3600,
          errorMessage: '该 IP 验证码发送次数超限',
        },
      ];
    case 'register':
      return [
        {
          scope: 'email',
          maxAttempts: 3,
          windowSeconds: 3600,
          errorMessage: '该邮箱注册尝试次数过多',
        },
        {
          scope: 'ip',
          maxAttempts: 5,
          windowSeconds: 60,
          errorMessage: '注册请求过于频繁',
        },
      ];
    case 'login':
      return [
        {
          scope: 'email',
          maxAttempts: 5,
          windowSeconds: 300,
          errorMessage: '登录尝试次数过多，账号已暂时锁定',
        },
        {
          scope: 'ip',
          maxAttempts: 20,
          windowSeconds: 300,
          errorMessage: '当前 IP 登录尝试过于频繁',
        },
      ];
    case 'resetPassword':
      return [
        {
          scope: 'email',
          maxAttempts: 1,
          windowSeconds: 60,
          errorMessage: '密码重置请求过于频繁',
        },
        {
          scope: 'ip',
          maxAttempts: 5,
          windowSeconds: 600,
          errorMessage: '当前 IP 密码重置请求过于频繁',
        },
      ];
  }
}

function buildIdentifier(
  context: AuthRequestContext,
  scope: RateLimitRule['scope']
): string | null {
  if (scope === 'email') {
    return context.email ?? null;
  }
  return context.ip || null;
}

function buildKey(
  action: AuthRateLimitAction,
  scope: RateLimitRule['scope'],
  identifier: string
): string {
  return `ratelimit:${action}:${scope}:${identifier}`;
}

function buildLoginFailureKeys(email: string, ip: string) {
  return {
    emailKey: buildKey('login', 'email', email),
    ipKey: buildKey('login', 'ip', ip),
  };
}

function formatRetrySuffix(ttlSeconds: number): string {
  return ttlSeconds > 0 ? `${ttlSeconds}秒后重试` : '请稍后重试';
}

async function checkRedisLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
  errorMessage: string
): Promise<void> {
  const client = getRedis();
  const results = await client.multi().incr(key).expire(key, windowSeconds).exec();
  const current = results?.[0]?.[1];
  const attempts = typeof current === 'number' ? current : Number(current ?? 0);

  if (attempts > maxAttempts) {
    const ttl = await client.ttl(key);
    throw ErrorHandler.createValidationError(
      `${errorMessage}（${formatRetrySuffix(ttl)}）`
    );
  }
}

async function assertRedisWindowAvailable(
  key: string,
  maxAttempts: number,
  errorMessage: string
): Promise<void> {
  const client = getRedis();
  const current = Number((await client.get(key)) ?? 0);

  if (current >= maxAttempts) {
    const ttl = await client.ttl(key);
    throw ErrorHandler.createValidationError(
      `${errorMessage}（${formatRetrySuffix(ttl)}）`
    );
  }
}

async function bumpRedisWindow(key: string, windowSeconds: number): Promise<void> {
  const client = getRedis();
  await client.multi().incr(key).expire(key, windowSeconds).exec();
}

async function clearRedisWindows(keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  await getRedis().del(...keys);
}

function checkFallbackLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
  errorMessage: string
): void {
  const now = Date.now();
  const existing = fallbackCounters.get(key);

  if (!existing || existing.expiresAt <= now) {
    fallbackCounters.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    });
    return;
  }

  existing.count += 1;
  if (existing.count > maxAttempts) {
    const ttlSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
    throw ErrorHandler.createValidationError(
      `${errorMessage}（${formatRetrySuffix(ttlSeconds)}）`
    );
  }
}

function readFallbackCount(key: string): number {
  const now = Date.now();
  const existing = fallbackCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    fallbackCounters.delete(key);
    return 0;
  }
  return existing.count;
}

function fallbackTtlSeconds(key: string): number {
  const existing = fallbackCounters.get(key);
  if (!existing) {
    return 0;
  }
  return Math.max(1, Math.ceil((existing.expiresAt - Date.now()) / 1000));
}

function assertFallbackWindowAvailable(
  key: string,
  maxAttempts: number,
  errorMessage: string
): void {
  const current = readFallbackCount(key);
  if (current >= maxAttempts) {
    throw ErrorHandler.createValidationError(
      `${errorMessage}（${formatRetrySuffix(fallbackTtlSeconds(key))}）`
    );
  }
}

function bumpFallbackWindow(key: string, windowSeconds: number): void {
  const now = Date.now();
  const existing = fallbackCounters.get(key);

  if (!existing || existing.expiresAt <= now) {
    fallbackCounters.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    });
    return;
  }

  existing.count += 1;
}

function clearFallbackWindows(keys: string[]): void {
  for (const key of keys) {
    fallbackCounters.delete(key);
  }
}

function resetState(): void {
  fallbackCounters.clear();
  redis?.disconnect();
  redis = null;
}

export class RateLimitService {
  static async check(action: AuthRateLimitAction, context: AuthRequestContext): Promise<void> {
    const rules = buildRules(action);

    for (const rule of rules) {
      const identifier = buildIdentifier(context, rule.scope);
      if (!identifier) {
        continue;
      }

      const key = buildKey(action, rule.scope, identifier);

      try {
        await checkRedisLimit(
          key,
          rule.maxAttempts,
          rule.windowSeconds,
          rule.errorMessage
        );
      } catch (error) {
        if (error instanceof AppError && error.type === ErrorType.VALIDATION) {
          throw error;
        }

        logger.warn('Redis unavailable for auth rate limiting, switching to in-memory fallback', {
          action,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        checkFallbackLimit(
          key,
          rule.maxAttempts,
          rule.windowSeconds,
          rule.errorMessage
        );
      }
    }
  }

  static async checkSendCode(email: string, ip: string): Promise<void> {
    await RateLimitService.check('sendVerifyCode', { email, ip });
  }

  static async checkRegister(ip: string, email?: string): Promise<void> {
    await RateLimitService.check('register', { email, ip });
  }

  static async checkLogin(email: string, ip: string): Promise<void> {
    await RateLimitService.check('login', { email, ip });
  }

  static async checkReset(email: string, ip: string): Promise<void> {
    await RateLimitService.check('resetPassword', { email, ip });
  }

  static async assertLoginAllowed(email: string, ip: string): Promise<void> {
    const { emailKey, ipKey } = buildLoginFailureKeys(email, ip);

    try {
      await assertRedisWindowAvailable(
        emailKey,
        LOGIN_EMAIL_FAILURE_LIMIT,
        LOGIN_LOCKED_MESSAGE
      );
      await assertRedisWindowAvailable(
        ipKey,
        LOGIN_IP_FAILURE_LIMIT,
        '当前 IP 登录尝试过于频繁'
      );
    } catch (error) {
      if (error instanceof AppError && error.type === ErrorType.VALIDATION) {
        throw error;
      }

      logger.warn('Redis unavailable for login failure window, switching to in-memory fallback', {
        emailKey: safeRateLimitKey(emailKey),
        ipKey: safeRateLimitKey(ipKey),
        error: error instanceof Error ? error.message : String(error),
      });
      assertFallbackWindowAvailable(emailKey, LOGIN_EMAIL_FAILURE_LIMIT, LOGIN_LOCKED_MESSAGE);
      assertFallbackWindowAvailable(ipKey, LOGIN_IP_FAILURE_LIMIT, '当前 IP 登录尝试过于频繁');
    }
  }

  static async recordLoginFailure(email: string, ip: string): Promise<void> {
    const { emailKey, ipKey } = buildLoginFailureKeys(email, ip);

    try {
      await bumpRedisWindow(emailKey, LOGIN_FAILURE_WINDOW_SECONDS);
      await bumpRedisWindow(ipKey, LOGIN_FAILURE_WINDOW_SECONDS);
    } catch (error) {
      logger.warn('Redis unavailable while recording login failure, using in-memory fallback', {
        emailKey: safeRateLimitKey(emailKey),
        ipKey: safeRateLimitKey(ipKey),
        error: error instanceof Error ? error.message : String(error),
      });
      bumpFallbackWindow(emailKey, LOGIN_FAILURE_WINDOW_SECONDS);
      bumpFallbackWindow(ipKey, LOGIN_FAILURE_WINDOW_SECONDS);
    }
  }

  static async clearLoginFailures(email: string, ip: string): Promise<void> {
    const { emailKey, ipKey } = buildLoginFailureKeys(email, ip);

    try {
      await clearRedisWindows([emailKey, ipKey]);
    } catch (error) {
      logger.warn('Redis unavailable while clearing login failure window, clearing in-memory fallback', {
        emailKey: safeRateLimitKey(emailKey),
        ipKey: safeRateLimitKey(ipKey),
        error: error instanceof Error ? error.message : String(error),
      });
      clearFallbackWindows([emailKey, ipKey]);
    }
  }

  static setRedisFactoryForTests(factory: (() => RedisClient) | null): void {
    resetState();
    redisFactory = factory;
  }

  static resetForTests(): void {
    resetState();
    redisFactory = null;
  }
}

export const __rateLimitServiceTestUtils = {
  setRedisFactory(factory: (() => RedisClient) | null) {
    RateLimitService.setRedisFactoryForTests(factory);
  },
  reset() {
    RateLimitService.resetForTests();
  },
};

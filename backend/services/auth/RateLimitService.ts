import Redis from 'ioredis';
import { config } from '../../config';
import { ErrorHandler } from '../../utils/errorHandler';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
  }
  return redis;
}

async function checkLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
  errorMessage: string
): Promise<void> {
  const r = getRedis();
  // 原子执行 INCR + EXPIRE，避免进程崩溃导致 key 永不过期
  const results = await r.multi().incr(key).expire(key, windowSeconds).exec();
  const current = results?.[0]?.[1] as number;
  if (current > maxAttempts) {
    const ttl = await r.ttl(key);
    throw ErrorHandler.createValidationError(
      `${errorMessage}（${ttl > 0 ? ttl + '秒后重试' : '请稍后重试'}）`
    );
  }
}

export class RateLimitService {
  static async checkSendCode(email: string, ip: string): Promise<void> {
    await checkLimit(
      `ratelimit:sendcode:email:${email}`,
      1,
      60,
      '验证码发送过于频繁'
    );
    await checkLimit(
      `ratelimit:sendcode:ip:${ip}`,
      10,
      3600,
      '该 IP 验证码发送次数超限'
    );
  }

  static async checkRegister(ip: string): Promise<void> {
    await checkLimit(
      `ratelimit:register:ip:${ip}`,
      5,
      60,
      '注册请求过于频繁'
    );
  }

  static async checkLogin(email: string): Promise<void> {
    await checkLimit(
      `ratelimit:login:email:${email}`,
      5,
      300,
      '登录尝试次数过多，账号已暂时锁定'
    );
  }

  static async checkReset(email: string): Promise<void> {
    await checkLimit(
      `ratelimit:reset:email:${email}`,
      1,
      60,
      '密码重置请求过于频繁'
    );
  }
}

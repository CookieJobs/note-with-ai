import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorHandler } from '../utils/errorHandler';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.QQ_EMAIL_USER = process.env.QQ_EMAIL_USER || 'test@example.com';
process.env.QQ_EMAIL_PASS = process.env.QQ_EMAIL_PASS || 'test-pass';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';

const manualRestores: Array<() => void> = [];

async function loadModules() {
  return {
    User: require('../models/User').default,
    AuthService: require('../services/auth/AuthService').AuthService,
    AuthFlowService: require('../services/auth/AuthFlowService').AuthFlowService,
    EmailService: require('../services/auth/EmailService').EmailService,
    RateLimitService: require('../services/auth/RateLimitService').RateLimitService,
    VerificationCodeService: require('../services/auth/VerificationCodeService').VerificationCodeService,
  };
}

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  manualRestores.push(() => {
    (target as any)[key] = original;
  });
}

describe('AuthFlowService', () => {
  afterEach(() => {
    mock.restoreAll();
    while (manualRestores.length > 0) {
      manualRestores.pop()?.();
    }
  });

  it('登录失败时会记录失败窗口，成功时会清空窗口', async () => {
    const { AuthService, AuthFlowService, RateLimitService } = await loadModules();

    const allowedCalls: Array<{ email: string; ip: string }> = [];
    const failureCalls: Array<{ email: string; ip: string }> = [];
    const clearCalls: Array<{ email: string; ip: string }> = [];

    replaceMethod(RateLimitService, 'assertLoginAllowed', (async (email: string, ip: string) => {
      allowedCalls.push({ email, ip });
    }) as any);
    replaceMethod(RateLimitService, 'recordLoginFailure', (async (email: string, ip: string) => {
      failureCalls.push({ email, ip });
    }) as any);
    replaceMethod(RateLimitService, 'clearLoginFailures', (async (email: string, ip: string) => {
      clearCalls.push({ email, ip });
    }) as any);

    replaceMethod(AuthService, 'login', (async () => {
      throw ErrorHandler.createAuthenticationError('邮箱或密码错误');
    }) as any);

    await assert.rejects(() =>
      AuthFlowService.login(
        { ip: '1.1.1.1', userAgent: 'test-agent' },
        { email: 'Test@Example.com', password: 'wrong' }
      )
    );

    assert.deepEqual(allowedCalls, [{ email: 'test@example.com', ip: '1.1.1.1' }]);
    assert.deepEqual(failureCalls, [{ email: 'test@example.com', ip: '1.1.1.1' }]);
    assert.deepEqual(clearCalls, []);

    replaceMethod(AuthService, 'login', (async () => ({
      token: 'token-1',
      user: { email: 'test@example.com' },
    })) as any);

    const result = await AuthFlowService.login(
      { ip: '1.1.1.1', userAgent: 'test-agent' },
      { email: 'Test@Example.com', password: 'correct' }
    );

    assert.deepEqual(result, {
      token: 'token-1',
      user: { email: 'test@example.com' },
    });
    assert.deepEqual(clearCalls, [{ email: 'test@example.com', ip: '1.1.1.1' }]);
  });

  it('发送验证码在反枚举命中时不会继续生成验证码和发信', async () => {
    const { AuthFlowService, EmailService, RateLimitService, User, VerificationCodeService } =
      await loadModules();

    const limitCalls: Array<Record<string, string>> = [];
    replaceMethod(RateLimitService, 'check', (async (_action: string, context: Record<string, string>) => {
      limitCalls.push(context);
    }) as any);

    mock.method(User, 'findOne', async () => null as any);

    let generated = 0;
    let sent = 0;
    replaceMethod(VerificationCodeService, 'generateCode', (async () => {
      generated += 1;
      return '123456';
    }) as any);
    replaceMethod(EmailService, 'sendVerificationCode', (async () => {
      sent += 1;
    }) as any);

    await AuthFlowService.sendVerifyCode(
      { ip: '2.2.2.2', userAgent: 'test-agent' },
      { email: 'missing@example.com', purpose: 'reset' }
    );

    assert.equal(generated, 0);
    assert.equal(sent, 0);
    assert.deepEqual(limitCalls, [{ email: 'missing@example.com', ip: '2.2.2.2', userAgent: 'test-agent' }]);
  });
});

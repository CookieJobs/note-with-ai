import User from '../../models/User';
import { AppError, ErrorHandler, ErrorType } from '../../utils/errorHandler';
import { logger } from '../../utils/logger';
import { AuthService } from './AuthService';
import { EmailService } from './EmailService';
import { RateLimitService } from './RateLimitService';
import { VerificationCodeService } from './VerificationCodeService';
import { AuthRequestContext, normalizeEmail } from './authContext';

type VerificationPurpose = 'register' | 'reset';

interface SendVerifyCodeInput {
  email: string;
  purpose: VerificationPurpose;
}

interface RegisterInput {
  email: string;
  password: string;
  code: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
}

export class AuthFlowService {
  static async sendVerifyCode(
    context: AuthRequestContext,
    input: SendVerifyCodeInput
  ): Promise<void> {
    const email = normalizeEmail(input.email);
    const scopedContext = { ...context, email };

    await RateLimitService.check('sendVerifyCode', scopedContext);

    // 反枚举：不暴露邮箱是否已注册，统一返回成功
    const existing = await User.findOne({ email });
    if ((input.purpose === 'register' && existing) || (input.purpose === 'reset' && !existing)) {
      return;
    }

    const code = await VerificationCodeService.generateCode(email, input.purpose);

    try {
      await EmailService.sendVerificationCode(email, code, input.purpose);
      logger.info(`Verification code sent to ${email} for ${input.purpose}`);
    } catch (error) {
      logger.error('Failed to send email:', error);
      throw ErrorHandler.createInternalError('验证码发送失败，请稍后重试');
    }
  }

  static async register(
    context: AuthRequestContext,
    input: RegisterInput
  ): Promise<{ token: string; user: Record<string, unknown> }> {
    const email = normalizeEmail(input.email);
    const scopedContext = { ...context, email };

    await RateLimitService.check('register', scopedContext);
    await VerificationCodeService.verifyCode(email, input.code, 'register');

    const result = await AuthService.register(email, input.password);
    await AuthService.markVerified(email);

    return result;
  }

  static async login(
    context: AuthRequestContext,
    input: LoginInput
  ): Promise<{ token: string; user: Record<string, unknown> }> {
    const email = normalizeEmail(input.email);
    const ip = context.ip;

    await RateLimitService.assertLoginAllowed(email, ip);

    try {
      const result = await AuthService.login(email, input.password);
      await RateLimitService.clearLoginFailures(email, ip);
      return result;
    } catch (error) {
      if (error instanceof AppError && error.type === ErrorType.AUTHENTICATION) {
        await RateLimitService.recordLoginFailure(email, ip);
      }
      throw error;
    }
  }

  static async resetPassword(
    context: AuthRequestContext,
    input: ResetPasswordInput
  ): Promise<{ token: string; user: Record<string, unknown> }> {
    const email = normalizeEmail(input.email);
    const scopedContext = { ...context, email };

    await RateLimitService.check('resetPassword', scopedContext);
    await VerificationCodeService.verifyCode(email, input.code, 'reset');

    return AuthService.resetPassword(email, input.newPassword);
  }
}

import { Request, Response } from 'express';
import User from '../../models/User';
import { VerificationCodeService } from '../../services/auth/VerificationCodeService';
import { EmailService } from '../../services/auth/EmailService';
import { AuthService } from '../../services/auth/AuthService';
import { RateLimitService } from '../../services/auth/RateLimitService';
import { ResponseHandler, ErrorHandler } from '../../utils/errorHandler';
import { logger } from '../../utils/logger';

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0].trim();
  return req.ip || '127.0.0.1';
}

// POST /api/auth/send-verify-code
export const sendVerifyCode = async (req: Request, res: Response) => {
  const { email, purpose } = req.body as {
    email: string;
    purpose: 'register' | 'reset';
  };
  const ip = getClientIp(req);

  // 频率限制
  await RateLimitService.checkSendCode(email, ip);

  // 反枚举：不暴露邮箱是否已注册，统一返回成功
  const existing = await User.findOne({ email });
  if (purpose === 'register' && existing) {
    ResponseHandler.success(res, null, '验证码已发送');
    return;
  }
  if (purpose === 'reset' && !existing) {
    ResponseHandler.success(res, null, '验证码已发送');
    return;
  }

  // 生成验证码
  const code = await VerificationCodeService.generateCode(email, purpose);

  // 发送邮件
  try {
    await EmailService.sendVerificationCode(email, code, purpose);
    logger.info(`Verification code sent to ${email} for ${purpose}`);
  } catch (err) {
    logger.error('Failed to send email:', err);
    throw ErrorHandler.createInternalError('验证码发送失败，请稍后重试');
  }

  ResponseHandler.success(res, null, '验证码已发送');
};

// POST /api/auth/register
export const register = async (req: Request, res: Response) => {
  const { email, password, code } = req.body as {
    email: string;
    password: string;
    code: string;
  };
  const ip = getClientIp(req);

  // 频率限制
  await RateLimitService.checkRegister(ip);

  // 校验验证码
  await VerificationCodeService.verifyCode(email, code, 'register');

  // 注册用户
  const result = await AuthService.register(email, password, code);

  // 标记已验证
  await AuthService.markVerified(email);

  ResponseHandler.success(res, result, '注册成功', 201);
};

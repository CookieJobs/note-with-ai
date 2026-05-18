import { Request, Response } from 'express';
import { VerificationCodeService } from '../../services/auth/VerificationCodeService';
import { AuthService } from '../../services/auth/AuthService';
import { RateLimitService } from '../../services/auth/RateLimitService';
import { ResponseHandler } from '../../utils/errorHandler';

// POST /api/auth/reset-password
export const resetPassword = async (req: Request, res: Response) => {
  const { email, code, newPassword } = req.body as {
    email: string;
    code: string;
    newPassword: string;
  };

  // 频率限制
  await RateLimitService.checkReset(email);

  // 校验验证码
  await VerificationCodeService.verifyCode(email, code, 'reset');

  // 重置密码
  const result = await AuthService.resetPassword(email, newPassword);

  ResponseHandler.success(res, result, '密码重置成功');
};

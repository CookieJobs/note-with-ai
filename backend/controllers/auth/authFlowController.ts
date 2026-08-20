import { Request, Response } from 'express';
import { ResponseHandler } from '../../utils/errorHandler';
import { AuthFlowService } from '../../services/auth/AuthFlowService';
import { buildAuthRequestContext } from '../../services/auth/authContext';

// POST /api/auth/send-verify-code
export const sendVerifyCode = async (req: Request, res: Response) => {
  const context = buildAuthRequestContext(req);
  const { email, purpose } = req.body as {
    email: string;
    purpose: 'register' | 'reset';
  };

  await AuthFlowService.sendVerifyCode(context, { email, purpose });

  ResponseHandler.success(res, null, '验证码已发送');
};

// POST /api/auth/register
export const register = async (req: Request, res: Response) => {
  const context = buildAuthRequestContext(req);
  const { email, password, code } = req.body as {
    email: string;
    password: string;
    code: string;
  };

  const result = await AuthFlowService.register(context, { email, password, code });

  ResponseHandler.success(res, result, '注册成功', 201);
};

// POST /api/auth/login
export const login = async (req: Request, res: Response) => {
  const context = buildAuthRequestContext(req);
  const { email, password } = req.body as {
    email: string;
    password: string;
  };

  const result = await AuthFlowService.login(context, { email, password });

  ResponseHandler.success(res, result, '登录成功');
};

// POST /api/auth/reset-password
export const resetPassword = async (req: Request, res: Response) => {
  const context = buildAuthRequestContext(req);
  const { email, code, newPassword } = req.body as {
    email: string;
    code: string;
    newPassword: string;
  };

  const result = await AuthFlowService.resetPassword(context, {
    email,
    code,
    newPassword,
  });

  ResponseHandler.success(res, result, '密码重置成功');
};

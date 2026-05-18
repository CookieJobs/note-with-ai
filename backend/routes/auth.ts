import express from 'express';
import { register, sendVerifyCode } from '../controllers/auth/registerController';
import { resetPassword } from '../controllers/auth/resetController';
import { login, getCurrentUser, updateProfile } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { validate } from '../middleware/validate';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  sendVerifyCodeSchema,
  resetPasswordSchema,
} from '../schemas/authSchemas';

const router = express.Router();

// 发送验证码
router.post('/send-verify-code', validate(sendVerifyCodeSchema), asyncHandler(async (req, res) => {
  await sendVerifyCode(req, res);
}));

// 用户注册
router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  await register(req, res);
}));

// 用户登录
router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  await login(req, res);
}));

// 密码重置
router.post('/reset-password', validate(resetPasswordSchema), asyncHandler(async (req, res) => {
  await resetPassword(req, res);
}));

// 获取当前用户信息（需要认证）
router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  await getCurrentUser(req, res);
}));

// 更新用户信息（需要认证）
router.put('/profile', authenticateToken, validate(updateProfileSchema), asyncHandler(async (req, res) => {
  await updateProfile(req, res);
}));

export default router;

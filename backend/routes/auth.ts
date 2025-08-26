// backend/routes/auth.ts
import express from 'express';
import { register, login, getCurrentUser, updateProfile } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';

const router = express.Router();

// 用户注册
router.post('/register', asyncHandler(async (req, res) => {
  await register(req, res);
}));

// 用户登录
router.post('/login', asyncHandler(async (req, res) => {
  await login(req, res);
}));

// 获取当前用户信息（需要认证）
router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  await getCurrentUser(req, res);
}));

// 更新用户信息（需要认证）
router.put('/profile', authenticateToken, asyncHandler(async (req, res) => {
  await updateProfile(req, res);
}));

export default router;
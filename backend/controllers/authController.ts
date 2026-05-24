/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/controllers/authController.ts
import { Request, Response } from 'express';
import User from '../models/User';
import { generateToken } from '../utils/jwt';
import { UserValidator } from '../utils/userValidation';
import { ResponseHandler, ErrorHandler, AppError } from '../utils/errorHandler';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';

// 用户注册
export const register = async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  // 检查唯一性
  await UserValidator.validateUniqueness(username, email);

  // 创建新用户
  const user = new User({ username, email, password });
  await user.save();

  // 生成token
  const token = generateToken({
    userId: user._id.toString(),
    username: user.username,
    email: user.email
  });

  ResponseHandler.success(res, {
    token,
    user: UserValidator.formatUserResponse(user)
  }, '注册成功', 201);
};

// 用户登录
export const login = async (req: Request, res: Response) => {
  const rawEmail = req.body?.email;
  const password = req.body?.password;

  // 查找用户（仅支持邮箱登录）
  const email = String(rawEmail ?? '').trim().toLowerCase();
  const user = await User.findOne({ email });

  if (!user) {
    if (process.env.NODE_ENV !== 'production') {
      const mongo = {
        host: mongoose.connection.host,
        db: mongoose.connection.name,
        readyState: mongoose.connection.readyState,
        hasMongoUri: !!process.env.MONGODB_URI,
      };
      const totalUsers = await User.countDocuments({});
      logger.warn('⚠️ 登录失败：邮箱不存在', { email, mongo, totalUsers });
    }
    throw ErrorHandler.createAuthenticationError('邮箱或密码错误');
  }

  // 验证密码
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('⚠️ 登录失败：密码不匹配', { email, userId: user._id?.toString?.() });
    }
    throw ErrorHandler.createAuthenticationError('邮箱或密码错误');
  }

  // 检查用户是否被禁用
  if (!user.isActive) {
    throw ErrorHandler.createAuthorizationError('账号已被禁用');
  }

  // 生成token
  const token = generateToken({
    userId: user._id.toString(),
    username: user.username,
    email: user.email
  });

  ResponseHandler.success(res, {
    token,
    user: UserValidator.formatUserResponse(user)
  }, '登录成功');
};

// 获取当前用户信息
export const getCurrentUser = async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  
  ResponseHandler.success(res, {
    user: UserValidator.formatUserResponse(user)
  });
};

// 修改密码
export const changePassword = async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  const { oldPassword, newPassword } = req.body;

  const isMatch = await user.comparePassword(oldPassword);
  if (!isMatch) {
    throw ErrorHandler.createValidationError('当前密码不正确');
  }

  user.password = newPassword;
  await user.save();

  ResponseHandler.success(res, null, '密码修改成功');
};

// 更新用户信息
export const updateProfile = async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  const { username, email, avatar } = req.body;

  // 如果要更新用户名或邮箱，检查是否已存在
  if (username && username !== user.username) {
    await UserValidator.validateUniqueness(username, undefined, user._id.toString());
  }

  if (email && email !== user.email) {
    await UserValidator.validateUniqueness(undefined, email, user._id.toString());
  }

  // 更新用户信息
  if (username) user.username = username;
  if (email) user.email = email;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();

  ResponseHandler.success(res, {
    user: UserValidator.formatUserResponse(user)
  }, '用户信息更新成功');
};
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
import { ResponseHandler, ErrorHandler } from '../utils/errorHandler';

// 用户注册
export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    // 验证必填字段
    UserValidator.validateUserInput(req.body, ['username', 'email', 'password']);
    
    // 验证格式
    UserValidator.validateUsernameFormat(username);
    UserValidator.validateEmailFormat(email);
    UserValidator.validatePasswordStrength(password);

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
  } catch (error) {
    if (error instanceof Error && error.message.includes('已存在')) {
      throw ErrorHandler.createValidationError(error.message);
    }
    console.error('注册失败:', error);
    throw ErrorHandler.createInternalError('注册失败，请稍后重试');
  }
};

// 用户登录
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // 验证必填字段
    UserValidator.validateUserInput(req.body, ['email', 'password']);

    // 查找用户（仅支持邮箱登录）
    const user = await User.findOne({ email });

    if (!user) {
      throw ErrorHandler.createAuthenticationError('邮箱或密码错误');
    }

    // 验证密码
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
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
  } catch (error) {
    console.error('登录失败:', error);
    throw ErrorHandler.createInternalError('登录失败，请稍后重试');
  }
};

// 获取当前用户信息
export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const user = await UserValidator.authenticateUser(req);
    
    ResponseHandler.success(res, {
      user: UserValidator.formatUserResponse(user)
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    throw ErrorHandler.createInternalError('获取用户信息失败');
  }
};

// 更新用户信息
export const updateProfile = async (req: Request, res: Response) => {
  try {
    const user = await UserValidator.authenticateUser(req);
    const { username, email, avatar } = req.body;
    
    // 验证格式
    if (username) UserValidator.validateUsernameFormat(username);
    if (email) UserValidator.validateEmailFormat(email);

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
  } catch (error) {
    if (error instanceof Error && error.message.includes('已存在')) {
      throw ErrorHandler.createValidationError(error.message);
    }
    console.error('更新用户信息失败:', error);
    throw ErrorHandler.createInternalError('更新用户信息失败');
  }
};
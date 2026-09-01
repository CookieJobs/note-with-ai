import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../../models/User';
import { generateToken } from '../../utils/jwt';
import { UserValidator } from '../../utils/userValidation';
import { ErrorHandler } from '../../utils/errorHandler';
import { logger } from '../../utils/logger';
import { trackProductEventBestEffort } from '../productEventService';

function buildUsernameBase(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 11);

  return normalized.length >= 2 ? normalized : 'user';
}

async function generateUniqueUsername(email: string): Promise<string> {
  const base = buildUsernameBase(email);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(4).toString('hex');
    const username = `${base}_${suffix}`.slice(0, 20);
    const existing = await User.exists({ username });

    if (!existing) {
      return username;
    }
  }

  throw ErrorHandler.createInternalError('用户名生成失败，请稍后重试');
}

export class AuthService {
  static buildAuthResult(
    user: InstanceType<typeof User>
  ): { token: string; user: Record<string, unknown> } {
    const token = generateToken({
      userId: user._id.toString(),
      username: user.username || '',
      email: user.email,
    });

    return {
      token,
      user: UserValidator.formatUserResponse(user),
    };
  }

  static async register(
    email: string,
    password: string
  ): Promise<{ token: string; user: Record<string, unknown> }> {
    // check uniqueness is done by VerificationCodeService via sendVerifyCode
    // here we double-check
    const existing = await User.findOne({ email });
    if (existing) {
      throw ErrorHandler.createValidationError('该邮箱已注册');
    }

    // Generate a stable fallback username so legacy unique indexes on username
    // cannot block email-based registration when username is omitted.
    const username = await generateUniqueUsername(email);
    const user = new User({ username, email, password });
    await user.save();
    trackProductEventBestEffort({ name: 'user_registered', userId: user._id.toString(), source: 'server', properties: {} });

    return AuthService.buildAuthResult(user);
  }

  static async login(
    email: string,
    password: string
  ): Promise<{ token: string; user: Record<string, unknown> }> {
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

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('⚠️ 登录失败：密码不匹配', { email, userId: user._id?.toString?.() });
      }
      throw ErrorHandler.createAuthenticationError('邮箱或密码错误');
    }

    if (!user.isActive) {
      throw ErrorHandler.createAuthorizationError('账号已被禁用');
    }

    return AuthService.buildAuthResult(user);
  }

  static async markVerified(email: string): Promise<void> {
    await User.findOneAndUpdate({ email }, { isVerified: true });
  }

  static async resetPassword(
    email: string,
    newPassword: string
  ): Promise<{ token: string; user: Record<string, unknown> }> {
    const user = await User.findOne({ email });
    if (!user) {
      throw ErrorHandler.createNotFoundError('该邮箱未注册');
    }

    user.password = newPassword;
    await user.save();

    return AuthService.buildAuthResult(user);
  }
}

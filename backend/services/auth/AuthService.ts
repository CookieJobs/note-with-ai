import crypto from 'crypto';
import User from '../../models/User';
import { generateToken } from '../../utils/jwt';
import { UserValidator } from '../../utils/userValidation';
import { ErrorHandler } from '../../utils/errorHandler';

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
  static async register(
    email: string,
    password: string,
    code: string
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
}

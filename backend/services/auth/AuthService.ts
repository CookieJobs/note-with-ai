import User from '../../models/User';
import { generateToken } from '../../utils/jwt';
import { UserValidator } from '../../utils/userValidation';
import { ErrorHandler } from '../../utils/errorHandler';

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

    // create user (isVerified will be set by caller after code verification)
    const user = new User({ email, password });
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

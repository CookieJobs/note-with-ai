import VerificationCode from '../../models/VerificationCode';
import { ErrorHandler } from '../../utils/errorHandler';

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class VerificationCodeService {
  static async generateCode(
    email: string,
    purpose: 'register' | 'reset'
  ): Promise<string> {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await VerificationCode.findOneAndUpdate(
      { email, purpose },
      { code, expiresAt, attempts: 0, used: false },
      { upsert: true, new: true }
    );

    return code;
  }

  static async verifyCode(
    email: string,
    code: string,
    purpose: 'register' | 'reset'
  ): Promise<void> {
    const record = await VerificationCode.findOne({ email, purpose });

    if (!record) {
      throw ErrorHandler.createValidationError('请先获取验证码');
    }

    if (record.used) {
      throw ErrorHandler.createValidationError('验证码已使用，请重新获取');
    }

    if (new Date() > record.expiresAt) {
      throw ErrorHandler.createValidationError('验证码已过期，请重新获取');
    }

    if (record.attempts >= 5) {
      throw ErrorHandler.createValidationError('验证码尝试次数过多，请重新获取');
    }

    if (record.code !== code) {
      // 原子递增 attempts，避免并发丢失
      const updated = await VerificationCode.findOneAndUpdate(
        { _id: record._id },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      const remaining = 5 - (updated?.attempts ?? 5);
      throw ErrorHandler.createValidationError(
        `验证码错误，还剩 ${remaining} 次机会`
      );
    }

    // 原子标记已使用，防止并发重复使用
    const consumed = await VerificationCode.findOneAndUpdate(
      { _id: record._id, used: false, code },
      { $set: { used: true } },
      { new: false }
    );

    if (!consumed) {
      throw ErrorHandler.createValidationError('验证码已使用，请重新获取');
    }
  }
}

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import OTPAuth from 'otpauth';
import { AdminAccount, AdminRole } from '../../models/AdminAccount';
import { decryptAdminSecret } from './adminCrypto';
import { RateLimitService } from '../auth/RateLimitService';
import { signAdminToken } from '../../utils/adminJwt';
import { recordAdminSecurityAudit } from './adminAuditService';
import { ErrorHandler } from '../../utils/errorHandler';

export const ADMIN_LOGIN_FAILURE_MESSAGE = '邮箱、密码或验证码错误';

type AdminRecord = { _id: { toString(): string }; email: string; displayName: string; passwordHash: string; totpSecretEncrypted: string; role: AdminRole; isActive: boolean; tokenVersion: number };

function emailHash(email: string): string { return crypto.createHash('sha256').update(email).digest('hex'); }
function validOtp(secret: string, otp: string): boolean {
  const totp = new OTPAuth.TOTP({ issuer: 'NoteWithAI', algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.validate({ token: otp, window: 1 }) !== null;
}

export async function authenticateAdmin(input: { email: string; password: string; otp: string; ip: string; requestId: string }) {
  const email = input.email.trim().toLowerCase();
  try {
    await RateLimitService.assertLoginAllowed(email, input.ip);
  } catch (error) {
    await recordAdminSecurityAudit({ requestId: input.requestId, action: 'admin.login', status: 'failed', metadata: { emailHash: emailHash(email), ip: input.ip, outcome: 'rate_limited' } });
    throw error;
  }
  const account = await AdminAccount.findOne({ email }).select('+passwordHash +totpSecretEncrypted').lean() as AdminRecord | null;
  const passwordValid = account ? await bcrypt.compare(input.password, account.passwordHash) : false;
  let otpValid = false;
  if (account && passwordValid) {
    try { otpValid = validOtp(decryptAdminSecret(account.totpSecretEncrypted), input.otp); } catch { otpValid = false; }
  }
  if (!account || !account.isActive || !passwordValid || !otpValid) {
    await RateLimitService.recordLoginFailure(email, input.ip);
    await recordAdminSecurityAudit({ requestId: input.requestId, action: 'admin.login', status: 'failed', metadata: { emailHash: emailHash(email), ip: input.ip, outcome: 'failure' } });
    throw ErrorHandler.createAuthenticationError(ADMIN_LOGIN_FAILURE_MESSAGE);
  }
  await RateLimitService.clearLoginFailures(email, input.ip);
  await AdminAccount.updateOne({ _id: account._id }, { $set: { lastLoginAt: new Date() } });
  await recordAdminSecurityAudit({ actorId: account._id.toString(), requestId: input.requestId, action: 'admin.login', status: 'succeeded', metadata: { ip: input.ip, outcome: 'success' } });
  return { admin: { id: account._id.toString(), email: account.email, displayName: account.displayName, role: account.role }, token: signAdminToken({ typ: 'admin', adminId: account._id.toString(), role: account.role, tokenVersion: account.tokenVersion }) };
}

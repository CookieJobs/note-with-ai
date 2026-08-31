import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import * as OTPAuth from 'otpauth';
import { config } from '../config';
import { ADMIN_ROLES, AdminRole, AdminAccount } from '../models/AdminAccount';
import { encryptAdminSecret } from '../services/admin/adminCrypto';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validatePassword(password: string): void {
  if (password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw new Error('ADMIN_CREATE_PASSWORD must be at least 12 characters and include letters and numbers');
  }
}

function getRole(value: string | undefined): AdminRole {
  const role = value || 'owner';
  if (!ADMIN_ROLES.includes(role as AdminRole)) throw new Error('ADMIN_CREATE_ROLE is invalid');
  return role as AdminRole;
}

export async function createAdminFromEnvironment(): Promise<{ email: string; provisioningUri: string }> {
  const email = requiredEnvironment('ADMIN_CREATE_EMAIL').toLowerCase();
  const displayName = requiredEnvironment('ADMIN_CREATE_DISPLAY_NAME');
  const password = requiredEnvironment('ADMIN_CREATE_PASSWORD');
  const role = getRole(process.env.ADMIN_CREATE_ROLE);
  validatePassword(password);

  const secret = process.env.ADMIN_CREATE_TOTP_SECRET?.trim() || new OTPAuth.Secret().base32;
  const totp = new OTPAuth.TOTP({
    issuer: 'NoteWithAI',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const passwordHash = await bcrypt.hash(password, 12);
  const update = {
    email,
    displayName,
    passwordHash,
    totpSecretEncrypted: encryptAdminSecret(secret),
    role,
    isActive: true,
  };
  const allowUpdate = process.env.ADMIN_CREATE_ALLOW_UPDATE === 'true';
  const existing = await AdminAccount.findOne({ email }).select('_id').lean() as { _id: mongoose.Types.ObjectId } | null;

  if (existing && !allowUpdate) {
    throw new Error('Admin account already exists; set ADMIN_CREATE_ALLOW_UPDATE=true to update it');
  }

  if (existing) {
    await AdminAccount.updateOne({ _id: existing._id }, { $set: update, $inc: { tokenVersion: 1 } });
  } else {
    await AdminAccount.create(update);
  }

  return { email, provisioningUri: totp.toString() };
}

export async function runCreateAdminCli(output: (message: string) => void = console.log): Promise<void> {
  const { email, provisioningUri } = await createAdminFromEnvironment();
  output(`Created admin: ${email}`);
  output(`TOTP provisioning URI: ${provisioningUri}`);
}

async function main(): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  try {
    await runCreateAdminCli();
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Admin bootstrap failed');
    process.exitCode = 1;
  });
}

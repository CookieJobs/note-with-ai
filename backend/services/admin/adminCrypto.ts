import crypto from 'crypto';

const PAYLOAD_VERSION = 'v1';

function getEncryptionKey(): Buffer {
  const value = process.env.ADMIN_ENCRYPTION_KEY;
  if (!value) throw new Error('ADMIN_ENCRYPTION_KEY is required');

  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('ADMIN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

export function encryptAdminSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PAYLOAD_VERSION, iv, encrypted, tag].map((part) => (
    typeof part === 'string' ? part : part.toString('base64url')
  )).join('.');
}

export function decryptAdminSecret(payload: string): string {
  const [version, ivEncoded, ciphertextEncoded, tagEncoded, ...extra] = payload.split('.');
  if (version !== PAYLOAD_VERSION || !ivEncoded || !ciphertextEncoded || !tagEncoded || extra.length > 0) {
    throw new Error('Invalid encrypted admin secret payload');
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Invalid encrypted admin secret payload');
  }
}

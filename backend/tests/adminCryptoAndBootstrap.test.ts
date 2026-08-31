import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminAccount, ADMIN_ROLES } from '../models/AdminAccount';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { parseConfig } from '../config';
import { decryptAdminSecret, encryptAdminSecret } from '../services/admin/adminCrypto';

process.env.ADMIN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

test('encrypts admin secrets with a random authenticated AES-256-GCM payload', () => {
  const encryptedA = encryptAdminSecret('JBSWY3DPEHPK3PXP');
  const encryptedB = encryptAdminSecret('JBSWY3DPEHPK3PXP');

  assert.match(encryptedA, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(encryptedA, encryptedB);
  assert.equal(decryptAdminSecret(encryptedA), 'JBSWY3DPEHPK3PXP');
  const tampered = `${encryptedA.slice(0, -1)}${encryptedA.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptAdminSecret(tampered));
});

test('admin account schema separates credentials and hides secret fields from JSON', () => {
  assert.deepEqual(ADMIN_ROLES, ['owner', 'operator', 'support', 'viewer']);
  assert.equal(AdminAccount.schema.path('email').options.unique, true);

  const admin = new AdminAccount({
    email: 'operator@example.com',
    displayName: 'Operator',
    passwordHash: 'hash',
    totpSecretEncrypted: 'encrypted',
  });
  const json = admin.toJSON();
  assert.equal('passwordHash' in json, false);
  assert.equal('totpSecretEncrypted' in json, false);
});

test('admin audit log has a unique request ID index', () => {
  const indexes = AdminAuditLog.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.requestId === 1 && options.unique === true));
});

test('production configuration rejects reused ordinary and admin JWT secrets', () => {
  assert.throws(
    () => parseConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      ADMIN_JWT_SECRET: 'a'.repeat(32),
      ADMIN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      MONGODB_URI: 'mongodb://localhost:27017/note-with-ai',
      REDIS_URL: 'redis://localhost:6379',
      QQ_EMAIL_USER: 'sender@example.com',
      QQ_EMAIL_PASS: 'password',
    }),
    /ADMIN_JWT_SECRET must differ from JWT_SECRET/
  );
});

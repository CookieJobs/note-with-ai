import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { AdminAccount, ADMIN_ROLES } from '../models/AdminAccount';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { config, parseConfig } from '../config';
import { decryptAdminSecret, encryptAdminSecret } from '../services/admin/adminCrypto';
import { createAdminFromEnvironment, runCreateAdminCli } from '../scripts/create_admin';

process.env.ADMIN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

test('encrypts admin secrets with a random authenticated AES-256-GCM payload', () => {
  const encryptedA = encryptAdminSecret('JBSWY3DPEHPK3PXP');
  const encryptedB = encryptAdminSecret('JBSWY3DPEHPK3PXP');

  assert.match(encryptedA, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(encryptedA, encryptedB);
  assert.equal(decryptAdminSecret(encryptedA), 'JBSWY3DPEHPK3PXP');
  const tamperedParts = encryptedA.split('.');
  tamperedParts[2] = `${tamperedParts[2].startsWith('A') ? 'B' : 'A'}${tamperedParts[2].slice(1)}`;
  const tampered = tamperedParts.join('.');
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

  const invalidRole = new AdminAccount({
    email: 'invalid@example.com',
    displayName: 'Invalid role',
    passwordHash: 'hash',
    totpSecretEncrypted: 'encrypted',
    role: 'administrator',
  });
  assert.ok(invalidRole.validateSync()?.errors.role);
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

test('password-only admin login can only be enabled in development', () => {
  const common = {
    JWT_SECRET: 'a'.repeat(32),
    ADMIN_JWT_SECRET: 'b'.repeat(32),
    ADMIN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    MONGODB_URI: 'mongodb://localhost:27017/note-with-ai',
    REDIS_URL: 'redis://localhost:6379',
    QQ_EMAIL_USER: 'sender@example.com',
    QQ_EMAIL_PASS: 'password',
  };
  assert.equal(parseConfig({ ...common, NODE_ENV: 'development', ADMIN_LOCAL_PASSWORD_ONLY: 'true' }).ADMIN_LOCAL_PASSWORD_ONLY, true);
  assert.throws(
    () => parseConfig({ ...common, NODE_ENV: 'production', ADMIN_LOCAL_PASSWORD_ONLY: 'true' }),
    /ADMIN_LOCAL_PASSWORD_ONLY is only allowed in development/
  );
});

test('the test command disables a locally inherited password-only admin login flag', () => {
  assert.equal(config.ADMIN_LOCAL_PASSWORD_ONLY, false);
});

test('production configuration rejects missing, malformed, and non-32-byte encryption keys', () => {
  const productionEnvironment = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(32),
    ADMIN_JWT_SECRET: 'b'.repeat(32),
    MONGODB_URI: 'mongodb://localhost:27017/note-with-ai',
    REDIS_URL: 'redis://localhost:6379',
    QQ_EMAIL_USER: 'sender@example.com',
    QQ_EMAIL_PASS: 'password',
  };

  assert.throws(() => parseConfig(productionEnvironment), /Invalid environment variables/);
  assert.throws(() => parseConfig({ ...productionEnvironment, ADMIN_ENCRYPTION_KEY: 'not-a-key' }), /Invalid environment variables/);
  assert.throws(() => parseConfig({ ...productionEnvironment, ADMIN_ENCRYPTION_KEY: Buffer.alloc(31, 7).toString('base64') }), /Invalid environment variables/);
  assert.throws(() => parseConfig({ ...productionEnvironment, ADMIN_ENCRYPTION_KEY: `${Buffer.alloc(32, 7).toString('base64')}!` }), /Invalid environment variables/);

  const startup = spawnSync(process.execPath, ['--import', 'tsx', '-e', "require('./config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ...productionEnvironment, ADMIN_ENCRYPTION_KEY: 'not-a-key' },
  });
  assert.notEqual(startup.status, 0);
  assert.match(`${startup.stderr}${startup.stdout}`, /Invalid environment variables/);
});

async function withBootstrapEnvironment<T>(
  values: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function mockAdminModel(existing: { _id: string } | null) {
  const calls: { created?: Record<string, unknown>; updated?: Record<string, unknown> } = {};
  const model = AdminAccount as unknown as Record<string, unknown>;
  const original = { findOne: model.findOne, create: model.create, updateOne: model.updateOne };
  model.findOne = () => ({ select: () => ({ lean: async () => existing }) });
  model.create = async (value: Record<string, unknown>) => { calls.created = value; };
  model.updateOne = async (_filter: unknown, value: Record<string, unknown>) => { calls.updated = value; };
  return {
    calls,
    restore: () => Object.assign(model, original),
  };
}

test('bootstrap validates password and role before persistence', async () => {
  const mocked = mockAdminModel(null);
  try {
    await withBootstrapEnvironment({
      ADMIN_CREATE_EMAIL: 'owner@example.com',
      ADMIN_CREATE_DISPLAY_NAME: 'Owner',
      ADMIN_CREATE_PASSWORD: 'letters-only-password',
      ADMIN_CREATE_ROLE: 'owner',
    }, async () => {
      await assert.rejects(createAdminFromEnvironment(), /ADMIN_CREATE_PASSWORD/);
    });
    await withBootstrapEnvironment({
      ADMIN_CREATE_EMAIL: 'owner@example.com',
      ADMIN_CREATE_DISPLAY_NAME: 'Owner',
      ADMIN_CREATE_PASSWORD: 'valid-password-123',
      ADMIN_CREATE_ROLE: 'administrator',
    }, async () => {
      await assert.rejects(createAdminFromEnvironment(), /ADMIN_CREATE_ROLE/);
    });
    assert.equal(mocked.calls.created, undefined);
  } finally {
    mocked.restore();
  }
});

test('bootstrap creates an owner by default with an encrypted TOTP secret', async () => {
  const mocked = mockAdminModel(null);
  try {
    await withBootstrapEnvironment({
      ADMIN_CREATE_EMAIL: 'OWNER@example.com',
      ADMIN_CREATE_DISPLAY_NAME: 'Owner',
      ADMIN_CREATE_PASSWORD: 'valid-password-123',
      ADMIN_CREATE_ROLE: undefined,
      ADMIN_CREATE_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    }, async () => {
      const result = await createAdminFromEnvironment();
      assert.equal(result.email, 'owner@example.com');
      assert.match(result.provisioningUri, /^otpauth:\/\/totp\//);
    });
    assert.equal(mocked.calls.created?.role, 'owner');
    assert.notEqual(mocked.calls.created?.totpSecretEncrypted, 'JBSWY3DPEHPK3PXP');
    assert.equal(decryptAdminSecret(mocked.calls.created?.totpSecretEncrypted as string), 'JBSWY3DPEHPK3PXP');
  } finally {
    mocked.restore();
  }
});

test('bootstrap refuses overwrite unless enabled and bumps the token version on update', async () => {
  const mocked = mockAdminModel({ _id: 'admin-1' });
  try {
    const values = {
      ADMIN_CREATE_EMAIL: 'owner@example.com',
      ADMIN_CREATE_DISPLAY_NAME: 'Owner',
      ADMIN_CREATE_PASSWORD: 'valid-password-123',
      ADMIN_CREATE_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    };
    await withBootstrapEnvironment({ ...values, ADMIN_CREATE_ALLOW_UPDATE: undefined }, async () => {
      await assert.rejects(createAdminFromEnvironment(), /already exists/);
    });
    await withBootstrapEnvironment({ ...values, ADMIN_CREATE_ALLOW_UPDATE: 'true' }, async () => {
      await createAdminFromEnvironment();
    });
    assert.deepEqual(mocked.calls.updated?.$inc, { tokenVersion: 1 });
  } finally {
    mocked.restore();
  }
});

test('CLI output contains only the created email and provisioning URI', async () => {
  const mocked = mockAdminModel(null);
  const messages: string[] = [];
  try {
    await withBootstrapEnvironment({
      ADMIN_CREATE_EMAIL: 'owner@example.com',
      ADMIN_CREATE_DISPLAY_NAME: 'Owner',
      ADMIN_CREATE_PASSWORD: 'valid-password-123',
      ADMIN_CREATE_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    }, async () => {
      await runCreateAdminCli((message) => messages.push(message));
    });
    assert.equal(messages.length, 2);
    assert.match(messages[0], /^Created admin: owner@example\.com$/);
    assert.match(messages[1], /^TOTP provisioning URI: otpauth:\/\/totp\//);
    assert.doesNotMatch(messages.join('\n'), /valid-password-123|mongodb:|\$2[aby]\$/);
  } finally {
    mocked.restore();
  }
});

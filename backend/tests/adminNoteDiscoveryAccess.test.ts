import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';
import { Types } from 'mongoose';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

test('Admin can persist and audit per-user trial access and cancel a queued run', noteDiscoveryMongoTestOptions, async () => {
  const cleanup = await connectNoteDiscoveryTestMongo('worker');
  try {
    const { AdminAccount } = await import('../models/AdminAccount');
    const { AdminAuditLog } = await import('../models/AdminAuditLog');
    const { default: User } = await import('../models/User');
    const { default: NoteDiscoveryRun } = await import('../models/NoteDiscoveryRun');
    const { config } = await import('../config');
    const { signAdminToken } = await import('../utils/adminJwt');
    const { generateToken } = await import('../utils/jwt');
    const { adminNoStore } = await import('../middleware/adminAuth');
    const { globalErrorHandler } = await import('../utils/errorHandler');
    const { default: usersRouter } = await import('../routes/admin/users');
    const { default: aiRouter } = await import('../routes/admin/ai');
    const { default: discoveryRouter } = await import('../routes/noteDiscoveries');
    const { isNoteDiscoveryAccessGranted } = await import('../services/noteDiscoveryAccess');
    const userId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();
    await User.collection.insertMany([
      { _id: userId, email: 'trial@example.invalid', isActive: true },
      { _id: otherUserId, email: 'other@example.invalid', isActive: true },
    ]);
    const owner = new Types.ObjectId(), viewer = new Types.ObjectId();
    await AdminAccount.collection.insertMany([
      { _id: owner, email: 'owner@example.invalid', role: 'owner', isActive: true, tokenVersion: 0 },
      { _id: viewer, email: 'viewer@example.invalid', role: 'viewer', isActive: true, tokenVersion: 0 },
    ]);
    const token = (role: 'owner' | 'viewer') => signAdminToken({
      typ: 'admin', adminId: (role === 'owner' ? owner : viewer).toHexString(), role, tokenVersion: 0,
    });

    const app = express();
    app.use(express.json(), cookieParser(), adminNoStore);
    app.use('/users', usersRouter);
    app.use('/ai', aiRouter);
    app.use('/discoveries', discoveryRouter);
    app.use(globalErrorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    try {
      const path = '/users/' + userId + '/note-discovery-access';
      async function request(pathname: string, role?: 'owner' | 'viewer', body?: object, origin = 'http://localhost:3000') {
        const response = await fetch('http://127.0.0.1:' + port + pathname, {
          method: body ? 'POST' : 'GET',
          headers: {
            origin, 'Content-Type': 'application/json',
            ...(role ? {cookie: 'nwai_admin_session=' + token(role)} : {}),
          },
          body: body && JSON.stringify(body),
        });
        assert.equal(response.headers.get('cache-control'), 'no-store');
        return {status: response.status, data: (await response.json()).data};
      }
      async function getDiscovery(account: Types.ObjectId, pathname = '/availability') {
        const accessToken = generateToken({userId: account.toHexString(), username: 'trial', email: 'trial@example.invalid'});
        const response = await fetch('http://127.0.0.1:' + port + '/discoveries' + pathname, {
          headers: {Authorization: 'Bearer ' + accessToken},
        });
        assert.equal(response.status, 200);
        return (await response.json()).data;
      }
      const environment = {enabled: config.NOTE_DISCOVERY_ENABLED, runnable: config.NOTE_DISCOVERY_RUNNABLE};
      assert.deepEqual((await request('/ai/note-discovery-status', 'viewer')).data, environment);
      assert.equal((await request(path)).status, 401);
      assert.deepEqual((await request(path, 'viewer')).data, {granted: false, environment});
      const grant = {granted: true, reason: '验证账号试用入口'};
      assert.equal((await request(path, 'viewer', grant)).status, 403);
      assert.equal((await request(path, 'owner', grant, 'https://untrusted.example.invalid')).status, 403);
      assert.equal((await request(path, 'owner', {granted: true, reason: '短'})).status, 400);
      assert.equal((await request('/users/not-an-id/note-discovery-access', 'owner')).status, 404);
      assert.equal(await isNoteDiscoveryAccessGranted(userId.toHexString()), false);

      assert.deepEqual((await request(path, 'owner', grant)).data, {granted: true, environment});
      assert.equal(await isNoteDiscoveryAccessGranted(userId.toHexString()), true);
      assert.equal(await isNoteDiscoveryAccessGranted(otherUserId.toHexString()), false);
      assert.deepEqual(await getDiscovery(userId), {available: environment.runnable});
      assert.deepEqual(await getDiscovery(otherUserId), {available: false});
      // Simulate a configured environment inside the isolation test. No worker
      // runs and this read does not admit a job or contact a provider.
      const originalRunnable = config.NOTE_DISCOVERY_RUNNABLE;
      config.NOTE_DISCOVERY_RUNNABLE = true;
      try {
        assert.deepEqual(await getDiscovery(userId), {available: true});
        assert.deepEqual(await getDiscovery(userId, '/'), {
          items: [], run: {status: 'idle'}, timeZone: 'Asia/Shanghai', automaticEnabled: false, available: true,
        });
        assert.deepEqual(await getDiscovery(otherUserId), {available: false});
      } finally {
        config.NOTE_DISCOVERY_RUNNABLE = originalRunnable;
      }
      const run = await NoteDiscoveryRun.create({
        userId, trigger: 'manual', idempotencyKey: 'admin-access-run', watermark: { changedAt: new Date() },
      });
      await User.updateOne({_id: userId}, {$set: {isActive: false}});
      assert.equal(await isNoteDiscoveryAccessGranted(userId.toHexString()), false);
      assert.deepEqual((await request(path, 'viewer')).data, {granted: true, environment});
      assert.deepEqual((await request(path, 'owner', {granted: false, reason: '结束该账户灰度验证'})).data, {granted: false, environment});
      assert.equal((await NoteDiscoveryRun.findById(run._id).lean())?.status, 'cancelled');
      assert.equal((await request(path, 'owner', grant)).status, 400);
      const audits = await AdminAuditLog.find({ action: 'user.note_discovery_access_changed', status: 'succeeded' }).lean();
      assert.equal(audits.length, 2);
      assert.deepEqual(audits.map(audit => audit.metadata?.command?.nextStatus).sort(), ['granted', 'revoked']);
      assert.ok(audits.every(audit => audit.targetId === userId.toHexString() && String(audit.actorId) === owner.toHexString()));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally {
    await cleanup();
  }
});

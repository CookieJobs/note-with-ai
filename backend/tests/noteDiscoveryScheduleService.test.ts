import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { config } from '../config';
import { Note } from '../models/Note';
import NoteDiscoveryPreference from '../models/NoteDiscoveryPreference';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import User from '../models/User';
import { NoteDiscoveryWorkerStore } from '../services/noteDiscoveryWorkerStore';
import { NoteDiscoveryScheduleService, discoveryLocalDate } from '../services/noteDiscoveryScheduleService';
import { connectNoteDiscoveryTestMongo, grantDiscoveryTestUser, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

it('uses IANA local dates across UTC and DST boundaries', () => {
  assert.equal(discoveryLocalDate(new Date('2026-11-18T16:01:00Z'), 'Asia/Shanghai'), '2026-11-19');
  assert.equal(discoveryLocalDate(new Date('2026-11-01T05:30:00Z'), 'America/New_York'), '2026-11-01');
  assert.equal(discoveryLocalDate(new Date('2026-11-01T06:30:00Z'), 'America/New_York'), '2026-11-01');
});

describe('durable discovery scheduling', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  let now: Date;
  let store: NoteDiscoveryWorkerStore;
  let service: NoteDiscoveryScheduleService;
  const userId = new Types.ObjectId().toHexString();
  const noteId = new Types.ObjectId().toHexString();
  const latest = () => Promise.resolve({ changedAt: new Date('2026-11-18T00:00:00Z'), noteId, revision: 1 });
  const create = (options = {}) => new NoteDiscoveryScheduleService({ enabled: true, now: () => now, store, readLatest: latest, ...options });
  before(async () => {
    cleanup = await connectNoteDiscoveryTestMongo('worker');
    await Promise.all([NoteDiscoveryPreference.init(), NoteDiscoveryRun.init()]);
  });
  after(async () => { await cleanup?.(); });
  beforeEach(async () => {
    await Promise.all([NoteDiscoveryPreference.deleteMany({}), NoteDiscoveryRun.deleteMany({}), Note.deleteMany({})]);
    await User.deleteMany({});
    await grantDiscoveryTestUser(userId);
    // Most scheduling cases describe an account that explicitly enabled automatic work.
    await NoteDiscoveryPreference.create({ userId, automaticEnabled: true });
    now = new Date('2026-11-18T00:00:00Z');
    store = new NoteDiscoveryWorkerStore({ now: () => now, leaseMs: 300_000 });
    service = create();
  });
  async function finish(status: 'no_result' | 'failed' = 'no_result') {
    const run = await store.claimNext(now);
    assert.ok(run);
    const result = await service.authorizeRun(run, now);
    assert.equal(result.status, 'authorized');
    await store.finish(run._id.toHexString(), run.leaseToken, status);
    return run;
  }
  it('scopes startup, edits and paid admission to the configured local account', async () => {
    const other = new Types.ObjectId().toHexString();
    const previous = config.NOTE_DISCOVERY_LOCAL_USER_ID;
    config.NOTE_DISCOVERY_LOCAL_USER_ID = userId;
    try {
      await User.updateOne({ _id: userId }, { $unset: { noteDiscoveryAccess: '' } });
      await User.collection.insertOne({ _id: new Types.ObjectId(other), isActive: true });
      await Note.create([{ userId, content: '测试记录', revision: 1 }, { userId: other, content: '另一个账号的记录', revision: 1 }]);
      assert.equal(await service.initializeOnStartup(now), 1);
      assert.equal(await NoteDiscoveryPreference.exists({ userId: other }), null);
      assert.equal((await service.requestManual(other, 'outside-scope')).status, 'disabled');
      await service.scheduleChanged(other, noteId, 1, now);
      assert.equal(await store.getActiveRun(other), null);
      const run = await store.enqueue(other, { changedAt: now }, 'old-outside-scope', { trigger: 'manual' });
      assert.ok(run);
      const claimed = await store.claimNext(new Date(now.getTime() + 1));
      assert.ok(claimed);
      const outside = claimed.userId.toHexString() === other ? claimed : await store.claimNext(new Date(now.getTime() + 1));
      assert.equal(outside?.userId.toHexString(), other);
      assert.equal((await service.authorizeRun(outside!)).status, 'disabled');
      assert.equal(await service.canPublish(outside!), false);
    } finally { config.NOTE_DISCOVERY_LOCAL_USER_ID = previous; }
  });
  it('starts newly granted accounts in manual-only mode until they explicitly opt in', async () => {
    await NoteDiscoveryPreference.deleteOne({ userId });
    await service.initializeOnVisit(userId, undefined, now);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.automaticEnabled, false);
    await service.scheduleChanged(userId, noteId, 2, now);
    assert.equal(await store.getActiveRun(userId), null);
    assert.equal((await service.setAutomaticEnabled(userId, true, now)).status, 'queued');
    assert.equal((await store.getActiveRun(userId))?.trigger, 'automatic');
  });

  it('debounces concurrent changes without charging admission before execution', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => create().scheduleChanged(userId, noteId, i + 1, new Date(now.getTime() + i * 1000))));
    const run = await store.getActiveRun(userId);
    assert.equal(run?.watermark.revision, 12);
    assert.equal(run?.availableAt.getTime(), now.getTime() + 131_000);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 0);
  });
  it('initializes once, records only successful scans and opens quietly with no changes', async () => {
    await service.initializeOnVisit(userId, 'Asia/Shanghai', now);
    await service.initializeOnVisit(userId, undefined, now);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 1);
    now = new Date(now.getTime() + 120_000);
    await finish();
    await service.reconcile(userId, now);
    now = new Date(now.getTime() + 25 * 3600_000);
    await service.initializeOnVisit(userId, undefined, now);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 1);
    assert.ok((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.lastSuccessfulAt);
  });
  it('keeps a running newer watermark and failed work durably retryable', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    now = new Date(now.getTime() + 120_000);
    const running = await store.claimNext(now);
    assert.ok(running);
    await service.authorizeRun(running, now);
    await service.scheduleChanged(userId, noteId, 2, now);
    await store.finish(running._id.toHexString(), running.leaseToken, 'failed');
    now = new Date(now.getTime() + 120_000);
    await create().scanDue(now);
    const next = await store.getActiveRun(userId);
    assert.equal(next?.watermark.revision, 2);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.lastSuccessfulAt, undefined);
  });
  it('preserves the dirty outbox across enqueue failure', async () => {
    const failing = create({ store: Object.assign(Object.create(store), { enqueue: async () => { throw new Error('offline'); } }) });
    await assert.rejects(failing.scheduleChanged(userId, noteId, 2, now), /offline/);
    now = new Date(now.getTime() + 120_000);
    await create().scanDue(now);
    assert.equal((await store.getActiveRun(userId))?.watermark.revision, 2);
  });
  it('charges one receipt across instances and limits queued successors by rolling hour', async () => {
    for (let i = 0; i < 3; i++) {
      await service.scheduleChanged(userId, noteId, i + 1, now);
      now = new Date(now.getTime() + 120_000);
      // Simulate a previously queued successor becoming due without calling scheduler enqueue.
      await NoteDiscoveryRun.updateMany({ status: 'queued' }, { $set: { availableAt: now } });
      const run = await store.claimNext(now);
      assert.ok(run);
      const admissions = await Promise.all(Array.from({ length: 12 }, () => create().authorizeRun(run, now)));
      assert.ok(admissions.every((a) => i < 2 ? a.status === 'authorized' : ['limited', 'stale'].includes(a.status)));
      if (i < 2) await store.finish(run._id.toHexString(), run.leaseToken, 'no_result');
      else {
        assert.ok(admissions.some((admission) => admission.retryAt));
        assert.equal((await store.getActiveRun(userId))?.status, 'queued');
      }
    }
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 2);
  });
  it('enforces 6 automatic daily/rolling24 starts even after timezone change', async () => {
    for (let i = 0; i < 7; i++) {
      await service.scheduleChanged(userId, noteId, i + 1, now);
      now = new Date(now.getTime() + 120_000);
      await NoteDiscoveryRun.updateMany({ status: 'queued' }, { $set: { availableAt: now } });
      const run = await store.claimNext(now);
      assert.ok(run);
      const result = await service.authorizeRun(run, now);
      assert.equal(result.status, i < 6 ? 'authorized' : 'limited');
      if (i < 6) await store.finish(run._id.toHexString(), run.leaseToken, 'no_result');
      now = new Date(now.getTime() + 3600_000);
      if (i === 5) await service.initializeOnVisit(userId, 'America/Los_Angeles', now);
    }
  });
  it('manual coalescing, 60 second cooldown and 3 daily cap are separate from automatic off', async () => {
    await service.setAutomaticEnabled(userId, false, now);
    for (let i = 0; i < 4; i++) {
      const result = await service.requestManual(userId, 'request-' + i, now);
      assert.equal(result.status, i < 3 ? 'queued' : 'limited');
      if (i < 3) {
        const replay = await service.requestManual(userId, 'request-' + i, now);
        assert.equal(replay.currentRun?._id.toHexString(), result.currentRun?._id.toHexString());
        await finish();
        if (i === 0) assert.equal((await service.requestManual(userId, 'cooldown', now)).status, 'limited');
      }
      now = new Date(now.getTime() + 60_000);
    }
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 3);
  });
  it('cancels only automatic queued work and blocks automatic publication after off', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const running = await store.claimNext(now);
    assert.ok(running);
    await service.authorizeRun(running, now);
    await service.requestManual(userId, 'manual-pending', now);
    await service.setAutomaticEnabled(userId, false, now);
    assert.equal(await service.canPublish(running), false);
    await store.finish(running._id.toHexString(), running.leaseToken, 'cancelled');
    await store.drainPending(userId);
    assert.equal((await store.getActiveRun(userId))?.trigger, 'manual');
    await service.setAutomaticEnabled(userId, true, now);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.automaticEnabled, true);
  });
  it('coalesces distinct manual clicks into the same running task with durable replay', async () => {
    await service.requestManual(userId, 'first', now);
    const running = await store.claimNext(now);
    assert.ok(running);
    await service.authorizeRun(running, now);
    const coalesced = await create().requestManual(userId, 'second', now);
    assert.equal(coalesced.currentRun?._id.toHexString(), running._id.toHexString());
    assert.equal((await store.getRun(userId, running._id.toHexString()))?.pendingWatermark, undefined);
    await store.finish(running._id.toHexString(), running.leaseToken, 'no_result');
    now = new Date(now.getTime() + 60_000);
    assert.equal((await create().requestManual(userId, 'second', now)).currentRun?._id.toHexString(), running._id.toHexString());
    assert.equal(await NoteDiscoveryRun.countDocuments(), 1);
  });
  it('retries a failed identical watermark instead of treating the attempt as a scan', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    await finish('failed');
    now = new Date(now.getTime() + 120_000);
    await create().scanDue(now);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 2);
    assert.equal((await store.getActiveRun(userId))?.status, 'queued');
  });
  it('bootstraps saved-note users once when the worker starts', async () => {
    await Note.create({ userId, content: 'saved note' });
    assert.equal(await service.initializeOnStartup(now), 1);
    assert.equal(await create().initializeOnStartup(now), 1);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 1);
  });
  it('24 hour visit fallback requires unscanned state and respects the exact boundary', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    await finish();
    await service.reconcile(userId, now);
    const newer = create({ readLatest: async () => ({ changedAt: new Date(now.getTime()), noteId, revision: 2 }) });
    now = new Date(now.getTime() + 24 * 3600_000);
    assert.equal((await newer.initializeOnVisit(userId, undefined, now)).status, 'idle');
    assert.equal(await NoteDiscoveryRun.countDocuments(), 1);
    now = new Date(now.getTime() + 1);
    await newer.initializeOnVisit(userId, undefined, now);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 2);
  });
  it('re-enabling stays quiet when the current saved state already scanned successfully', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    await finish();
    await service.reconcile(userId, now);
    await service.setAutomaticEnabled(userId, false, now);
    now = new Date(now.getTime() + 60_000);
    await service.setAutomaticEnabled(userId, true, now);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 1);
    assert.equal(await store.getActiveRun(userId), null);
  });
  it('retains capped changes until the rolling hour clears and then admits exactly once', async () => {
    for (let i = 0; i < 2; i++) {
      await service.scheduleChanged(userId, noteId, i + 1, now);
      now = new Date(now.getTime() + 120_000);
      await finish();
    }
    await service.scheduleChanged(userId, noteId, 3, now);
    const queued = await store.getActiveRun(userId);
    assert.ok(queued);
    const version = (await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.version;
    assert.equal(await service.scanDue(now), 0);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.version, version);
    now = new Date(queued.availableAt.getTime() - 1);
    assert.equal(await store.claimNext(now), null);
    now = new Date(now.getTime() + 1);
    await finish();
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 3);
  });
  it('manual local midnight does not reset rolling24 or cooldown defenses', async () => {
    now = new Date('2026-11-18T15:59:00Z');
    const limited = create({ manualDailyLimit: 1 });
    await limited.requestManual(userId, 'before-midnight', now);
    const run = await store.claimNext(now);
    assert.ok(run);
    await limited.authorizeRun(run, now);
    await store.finish(run._id.toHexString(), run.leaseToken, 'no_result');
    now = new Date('2026-11-18T16:01:00Z');
    const result = await limited.requestManual(userId, 'after-midnight', now);
    assert.equal(result.status, 'limited');
    assert.equal(result.retryAt?.toISOString(), '2026-11-19T15:59:00.000Z');
  });
  it('keeps local-day protection throughout a 25 hour DST day', async () => {
    now = new Date('2026-11-01T04:30:00Z');
    const limited = create({ manualDailyLimit: 1 });
    await limited.initializeOnVisit(userId, 'America/New_York', now);
    await limited.setAutomaticEnabled(userId, false, now);
    await limited.requestManual(userId, 'dst-first', now);
    const run = await store.claimNext(now);
    assert.ok(run);
    await limited.authorizeRun(run, now);
    await store.finish(run._id.toHexString(), run.leaseToken, 'no_result');
    now = new Date('2026-11-02T04:30:00Z');
    const result = await limited.requestManual(userId, 'dst-second', now);
    assert.equal(result.status, 'limited');
    assert.equal(result.retryAt?.toISOString(), '2026-11-02T05:00:00.000Z');
    now = new Date('2026-11-02T05:00:00Z');
    assert.equal((await limited.requestManual(userId, 'dst-second', now)).status, 'queued');
  });
  it('closes automatic off racing a successful enqueue reply without cancelling manual work', async () => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slowStore = Object.assign(Object.create(store), {
      enqueue: async (...args: Parameters<NoteDiscoveryWorkerStore['enqueue']>) => {
        const run = await store.enqueue(...args);
        entered();
        await gate;
        return run;
      },
    });
    const scheduled = create({ store: slowStore }).scheduleChanged(userId, noteId, 1, now);
    await waiting;
    await service.setAutomaticEnabled(userId, false, now);
    await service.requestManual(userId, 'off-race-manual', now);
    release();
    await scheduled;
    assert.equal((await store.getActiveRun(userId))?.trigger, 'manual');
    assert.equal(await NoteDiscoveryRun.countDocuments({ status: 'queued', trigger: 'automatic' }), 0);
  });
  it('refreshes successful scan time when a later manual run scans the same saved watermark', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    await finish();
    await service.reconcile(userId, now);
    now = new Date(now.getTime() + 120_000);
    await service.requestManual(userId, 'same-state-scan', now);
    await finish();
    await service.reconcile(userId, now);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.lastSuccessfulAt?.getTime(), now.getTime());
  });
  it('does not defer an already-sent run without an admission receipt', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const run = await store.claimNext(now);
    assert.ok(run);
    // Simulates a misordered caller. The scheduler must never requeue a sent run.
    await NoteDiscoveryPreference.updateOne({ userId }, { $set: { 'schedule.admissions': [
      { runId: new Types.ObjectId().toHexString(), trigger: 'automatic', at: now },
      { runId: new Types.ObjectId().toHexString(), trigger: 'automatic', at: now },
    ] } });
    await NoteDiscoveryRun.updateOne({ _id: run._id }, { $set: { providerStartedAt: now } });
    assert.equal((await service.authorizeRun(run, now)).status, 'stale');
    assert.equal((await store.getActiveRun(userId))?.status, 'running');
  });
  it('does not automatically replay an unknown-delivery failure without a new change', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    const run = await store.claimNext(now);
    assert.ok(run);
    await service.authorizeRun(run, now);
    await NoteDiscoveryRun.updateOne({ _id: run._id }, { $set: { providerDeliveryUnknown: true } });
    await store.finish(run._id.toHexString(), run.leaseToken, 'failed', { failureCategory: 'usage_unknown' });
    now = new Date(now.getTime() + 120_000);
    await service.scanDue(now);
    const blockedVersion = (await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.version;
    assert.equal(await create().scanDue(now), 0);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.version, blockedVersion);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 1);
    assert.equal(await store.getActiveRun(userId), null);
    await service.scheduleChanged(userId, noteId, 2, now);
    assert.equal(await NoteDiscoveryRun.countDocuments(), 2);
  });
  it('startup catches changes missed while the global feature was off within 24 hours', async () => {
    await Note.create({ userId, content: 'saved note' });
    await service.initializeOnVisit(userId, undefined, now);
    await finish();
    await service.reconcile(userId, now);
    now = new Date(now.getTime() + 60_000);
    const restarted = create({ readLatest: async () => ({ changedAt: now, noteId, revision: 2 }) });
    await restarted.initializeOnStartup(now);
    assert.equal((await store.getActiveRun(userId))?.watermark.revision, 2);
  });
  it('admits no receipt while a newer durable outbox change is still in its silence window', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const slow = Object.assign(Object.create(store), { enqueue: async (...args: Parameters<NoteDiscoveryWorkerStore['enqueue']>) => {
      entered(); await gate; return store.enqueue(...args);
    } });
    const later = create({ store: slow }).scheduleChanged(userId, new Types.ObjectId().toHexString(), 1, now);
    await waiting;
    const run = await store.claimNext(now);
    assert.ok(run);
    const result = await service.authorizeRun(run, now);
    release();
    await later;
    assert.equal(result.status, 'limited');
    assert.equal(result.retryAt?.getTime(), now.getTime() + 120_000);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 0);
  });
  it('out-of-order callbacks cannot shorten the latest silence deadline', async () => {
    const later = new Date(now.getTime() + 60_000);
    await service.scheduleChanged(userId, noteId, 1, later);
    await service.scheduleChanged(userId, new Types.ObjectId().toHexString(), 1, now);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.dueAt?.getTime(), later.getTime() + 120_000);
  });
  it('unknown delivery survives a subsequent ordinary manual failure and off/on', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    const first = await store.claimNext(now);
    assert.ok(first);
    await service.authorizeRun(first, now);
    await NoteDiscoveryRun.updateOne({ _id: first._id }, { $set: { providerDeliveryUnknown: true } });
    await store.finish(first._id.toHexString(), first.leaseToken, 'failed', { failureCategory: 'usage_unknown' });
    await service.requestManual(userId, 'explicit-once', now);
    await finish('failed');
    now = new Date(now.getTime() + 120_000);
    await service.scanDue(now);
    assert.equal(await store.getActiveRun(userId), null);
    await service.setAutomaticEnabled(userId, false, now);
    await service.setAutomaticEnabled(userId, true, now);
    assert.equal(await store.getActiveRun(userId), null);
  });
  it('clears covered and unknown-blocked due markers so quiet polling preserves versions', async () => {
    await service.initializeOnVisit(userId, undefined, now);
    await finish();
    await service.reconcile(userId, now);
    const before = await NoteDiscoveryPreference.findOne({ userId }).lean();
    assert.equal(await service.scanDue(now), 0);
    assert.equal(await service.scanDue(now), 0);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.version, before?.schedule?.version);
  });
  it('does not defer with an expired lease after waiting for the preference CAS', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const run = await store.claimNext(now);
    assert.ok(run);
    await NoteDiscoveryPreference.updateOne({ userId }, { $set: { 'schedule.admissions': [
      { runId: new Types.ObjectId().toHexString(), trigger: 'automatic', at: now },
      { runId: new Types.ObjectId().toHexString(), trigger: 'automatic', at: now },
    ] } });
    const original = NoteDiscoveryPreference.findOneAndUpdate;
    NoteDiscoveryPreference.findOneAndUpdate = function (this: typeof NoteDiscoveryPreference, ...args: unknown[]) {
      now = new Date(run.leaseUntil.getTime() + 1);
      return original.apply(this, args as Parameters<typeof original>);
    } as typeof original;
    try { assert.equal((await service.authorizeRun(run, new Date(now))).status, 'stale'); }
    finally { NoteDiscoveryPreference.findOneAndUpdate = original; }
    assert.equal((await store.getRun(userId, run._id.toHexString()))?.status, 'running');
  });
  it('absorbs automatic pending during deferral and never promotes unknown-delivery work twice', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const first = await store.claimNext(now);
    assert.ok(first);
    await service.scheduleChanged(userId, noteId, 2, now);
    assert.equal((await store.getRun(userId, first._id.toHexString()))?.pendingWatermark?.revision, 2);
    const deferred = await service.authorizeRun(first, now);
    assert.equal(deferred.status, 'limited');
    const queued = await store.getActiveRun(userId);
    assert.equal(queued?.watermark.revision, 2);
    assert.equal(queued?.pendingWatermark, undefined);
    now = new Date(deferred.retryAt!);
    const second = await store.claimNext(now);
    assert.ok(second);
    assert.equal((await service.authorizeRun(second, now)).status, 'authorized');
    await NoteDiscoveryRun.updateOne({ _id: second._id }, { $set: { providerDeliveryUnknown: true } });
    await store.finish(second._id.toHexString(), second.leaseToken, 'failed', { failureCategory: 'usage_unknown' });
    await service.reconcile(userId, now);
    assert.equal(await store.drainPending(userId), 0);
    assert.equal(await store.claimNext(now), null);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 1);
  });
  it('independently blocks an automatic run directly promoted from unknown pending', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const first = await store.claimNext(now);
    assert.ok(first);
    assert.equal((await service.authorizeRun(first, now)).status, 'authorized');
    // Simulates persisted same-state pending from an older worker. claimNext drains
    // without scheduler.reconcile, so authorizeRun must enforce the barrier itself.
    await NoteDiscoveryRun.updateOne({ _id: first._id }, { $set: {
      pendingWatermark: first.watermark, pendingIdempotencyKey: 'legacy-auto-pending', pendingTrigger: 'automatic', pendingAvailableAt: now,
      providerDeliveryUnknown: true,
    } });
    await store.finish(first._id.toHexString(), first.leaseToken, 'failed', { failureCategory: 'usage_unknown' });
    const promoted = await store.claimNext(now);
    assert.ok(promoted);
    await store.enqueue(userId, { ...promoted.watermark, noteId: promoted.watermark.noteId?.toHexString() }, 'keep-manual-after-block', { trigger: 'manual' });
    assert.equal((await create().authorizeRun(promoted, now)).status, 'blocked');
    assert.equal((await store.getRun(userId, promoted._id.toHexString()))?.status, 'cancelled');
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 1);
    assert.equal((await store.getRun(userId, promoted._id.toHexString()))?.pendingTrigger, 'manual');
    const manual = await store.claimNext(now);
    assert.ok(manual);
    assert.equal(manual.trigger, 'manual');
    assert.equal((await service.authorizeRun(manual, now)).status, 'authorized');
  });
  it('preserves manual pending while absorbing its watermark into a deferred automatic run', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const first = await store.claimNext(now);
    assert.ok(first);
    await service.scheduleChanged(userId, noteId, 2, now);
    await service.requestManual(userId, 'preserve-manual', now);
    assert.equal((await service.authorizeRun(first, now)).status, 'limited');
    const row = await store.getRun(userId, first._id.toHexString());
    assert.equal(row?.watermark.revision, 2);
    assert.equal(row?.pendingWatermark?.revision, 2);
    assert.equal(row?.pendingTrigger, 'manual');
    assert.equal(row?.pendingIdempotencyKey, 'manual:preserve-manual');
  });
  it('preserves automatic pending newer than the absorbed outbox watermark', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const first = await store.claimNext(now);
    assert.ok(first);
    await service.scheduleChanged(userId, noteId, 2, now);
    const newer = { changedAt: new Date(now), noteId, revision: 3 };
    await store.enqueue(userId, newer, 'greater-pending', { availableAt: new Date(now.getTime() + 121_000) });
    assert.equal((await service.authorizeRun(first, now)).status, 'limited');
    const row = await store.getRun(userId, first._id.toHexString());
    assert.equal(row?.watermark.revision, 2);
    assert.equal(row?.pendingWatermark?.revision, 3);
    assert.equal(row?.pendingIdempotencyKey, 'greater-pending');
  });
  it('never cancels an expired lease while independently enforcing unknown admission', async () => {
    await service.scheduleChanged(userId, noteId, 1, now);
    now = new Date(now.getTime() + 120_000);
    const run = await store.claimNext(now);
    assert.ok(run);
    await NoteDiscoveryRun.create({ userId, trigger: 'automatic', status: 'failed', idempotencyKey: 'historical-unknown',
      watermark: run.watermark, availableAt: now, finishedAt: now, providerDeliveryUnknown: true,
    });
    now = new Date(run.leaseUntil.getTime() + 1);
    assert.equal((await service.authorizeRun(run, now)).status, 'stale');
    const unchanged = await store.getRun(userId, run._id.toHexString());
    assert.equal(unchanged?.status, 'running');
    assert.equal(unchanged?.leaseToken, run.leaseToken);
    assert.equal((await NoteDiscoveryPreference.findOne({ userId }).lean())?.schedule?.admissions.length, 0);
  });
  it('does nothing when feature disabled and rejects invalid browser zones', async () => {
    await create({ enabled: false }).scheduleChanged(userId, noteId, 1, now);
    assert.equal((await create({ enabled: false }).requestManual(userId, 'x', now)).status, 'disabled');
    assert.equal(await NoteDiscoveryRun.countDocuments(), 0);
    await assert.rejects(service.initializeOnVisit(userId, '+08:00', now), /IANA/);
  });
});

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import NoteDiscoveryBudget from '../models/NoteDiscoveryBudget';
import NoteDiscoveryPreference from '../models/NoteDiscoveryPreference';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import { NoteDiscoveryBudgetService } from '../services/noteDiscoveryBudgetService';
import { NoteDiscoveryWorkerStore, type ClaimedDiscoveryRun } from '../services/noteDiscoveryWorkerStore';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

const pricedCall = {
  provider: 'test-provider',
  model: 'test-model',
  inputCnyPerMillion: 1,
  outputCnyPerMillion: 1,
  maxInputTokens: 6,
  maxOutputTokens: 4,
};

describe('discovery worker store on MongoDB', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  let now: Date;
  let budget: NoteDiscoveryBudgetService;
  let store: NoteDiscoveryWorkerStore;
  const owner = new Types.ObjectId();
  const userId = owner.toHexString();
  const otherUser = new Types.ObjectId().toHexString();
  const watermark = (offset = 0) => ({ changedAt: new Date(Date.UTC(2026, 10, 18) + offset) });

  before(async () => {
    cleanup = await connectNoteDiscoveryTestMongo('worker');
    await Promise.all([NoteDiscoveryBudget.init(), NoteDiscoveryPreference.init(), NoteDiscoveryRun.init()]);
  });
  after(async () => { await cleanup?.(); });
  beforeEach(async () => {
    now = watermark().changedAt;
    budget = new NoteDiscoveryBudgetService({
      enabled: true, userCapMicros: 40, globalCapMicros: 100, attemptCapMicros: 30,
    }, () => now);
    store = new NoteDiscoveryWorkerStore({ budget, now: () => now, leaseMs: 1_000 });
    await Promise.all([NoteDiscoveryBudget.deleteMany({}), NoteDiscoveryPreference.deleteMany({}), NoteDiscoveryRun.deleteMany({})]);
  });

  function fence(run: ClaimedDiscoveryRun) {
    return { runId: run._id.toHexString(), userId, generation: run.generation, leaseToken: run.leaseToken };
  }

  async function claim() {
    const run = await store.claimNext(now);
    assert.ok(run);
    return run;
  }

  it('creates one queued run under concurrent enqueue and enforces the active index independently', async () => {
    const runs = await Promise.all(Array.from({ length: 18 }, (_, index) =>
      store.enqueue(userId, watermark(index), 'same-' + index)));
    assert.equal(new Set(runs.map((run) => run?._id.toHexString())).size, 1);
    assert.ok(runs.every(Boolean));
    const active = await store.getActiveRun(userId);
    assert.equal(active?.watermark.changedAt.getTime(), watermark(17).changedAt.getTime());
    await assert.rejects(NoteDiscoveryRun.create({
      userId: owner, idempotencyKey: 'bypass', watermark: watermark(18),
    }), (error: unknown) => (error as { code?: number }).code === 11000);
    assert.equal(await store.getRun(otherUser, active!._id.toHexString()), null);
  });

  it('honors availableAt and never hands the same queued task to two workers', async () => {
    const availableAt = watermark(1_000).changedAt;
    await store.enqueue(userId, watermark(), 'future', { availableAt });
    assert.equal(await store.claimNext(now), null);
    now = availableAt;
    const claims = (await Promise.all(Array.from({ length: 10 }, () => store.claimNext(now)))).filter(Boolean);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.generation, 1);
  });

  it('keeps arrivals concurrent with finish and replays durable pending promotion idempotently', async () => {
    await store.enqueue(userId, watermark(), 'first');
    const original = await claim();
    await store.enqueue(userId, watermark(1), 'later1');
    await store.enqueue(userId, watermark(2), 'later2');
    const key = original._id.toHexString();
    const [completed] = await Promise.all([
      store.finish(key, original.leaseToken, 'completed'),
      ...Array.from({ length: 12 }, (_, index) => store.enqueue(userId, watermark(3 + index), 'later' + (3 + index))),
    ]);
    assert.equal(completed, true);
    assert.equal(await store.finish(key, original.leaseToken, 'failed'), false);
    await Promise.all([store.drainPending(), store.drainPending()]);
    const next = await claim();
    assert.notEqual(next._id.toHexString(), key);
    assert.equal(next.watermark.changedAt.getTime(), watermark(14).changedAt.getTime());
    const stored = await store.getRun(userId, key);
    assert.equal(stored?.status, 'completed');
    assert.equal(stored?.generation, original.generation);
    await store.finish(next._id.toHexString(), next.leaseToken, 'no_result');
    assert.equal(await store.claimNext(now), null);
    assert.equal((await store.enqueue(userId, watermark(), 'first'))?._id.toHexString(), key);
  });

  it('drains a terminal row left behind after a crash before promotion', async () => {
    await NoteDiscoveryRun.create({
      userId: owner, idempotencyKey: 'before-crash', watermark: watermark(), status: 'no_result',
      pendingWatermark: watermark(42), pendingIdempotencyKey: 'during-run', pendingAvailableAt: now,
    });
    const promoted = await claim();
    assert.equal(promoted.idempotencyKey, 'during-run');
    assert.equal(promoted.watermark.changedAt.getTime(), watermark(42).changedAt.getTime());
    assert.equal(await store.drainPending(), 0);
  });

  it('replays a coalesced manual key against the original completed run', async () => {
    const queued = await store.enqueue(userId, watermark(), 'Q', { trigger: 'manual' });
    const merged = await store.enqueue(userId, watermark(), 'M', { trigger: 'manual' });
    assert.equal(merged?._id.toHexString(), queued?._id.toHexString());
    const run = await claim();
    assert.equal(await store.finish(run._id.toHexString(), run.leaseToken, 'no_result'), true);
    const replay = await store.enqueue(userId, watermark(), 'M', { trigger: 'manual' });
    assert.equal(replay?._id.toHexString(), run._id.toHexString());
    assert.equal(await store.claimNext(now), null);
  });

  it('replays a stale manual promotion after another drainer merges, acknowledges, and finishes it', async () => {
    await NoteDiscoveryRun.create({
      userId: owner, idempotencyKey: 'P', watermark: watermark(), status: 'no_result',
      pendingWatermark: watermark(1), pendingIdempotencyKey: 'M', pendingTrigger: 'manual', pendingAvailableAt: now,
    });
    const queued = await store.enqueue(userId, watermark(2), 'Q', { trigger: 'manual' });
    const delayed = new NoteDiscoveryWorkerStore({ budget, now: () => now });
    const promote = delayed['enqueueStored'].bind(delayed);
    let didRead!: () => void;
    const snapshotRead = new Promise<void>((resolve) => { didRead = resolve; });
    let release!: () => void;
    const canResume = new Promise<void>((resolve) => { release = resolve; });
    delayed['enqueueStored'] = async (...args: Parameters<typeof promote>) => {
      didRead();
      await canResume;
      return promote(...args);
    };
    const staleDrain = delayed.drainPending();
    try {
      await snapshotRead;
      assert.equal(await store.drainPending(), 1);
      const run = await claim();
      assert.equal(run._id.toHexString(), queued?._id.toHexString());
      assert.equal(await store.finish(run._id.toHexString(), run.leaseToken, 'no_result'), true);
    } finally {
      release();
      await staleDrain;
    }
    assert.equal(await store.claimNext(now), null);
  });

  it('preserves a manual promotion merged into a second running predecessor', async () => {
    await store.enqueue(userId, watermark(), 'P');
    const first = await claim();
    const accepted = await store.enqueue(userId, watermark(3), 'M', { trigger: 'manual' });
    assert.equal(accepted?._id.toHexString(), first._id.toHexString());
    // A replacement was already running when the first run's outbox was drained.
    assert.equal(await store.finish(first._id.toHexString(), first.leaseToken, 'no_result'), true);
    const queued = await store.enqueue(userId, watermark(2), 'Q');
    assert.ok(queued);
    await NoteDiscoveryRun.updateOne({ _id: queued._id }, {
      $set: { status: 'running', leaseToken: '1:00000000-0000-0000-0000-000000000001', leaseUntil: watermark(1_000).changedAt, generation: 1 },
    });
    assert.equal(await store.drainPending(), 1);
    const second = await store.getActiveRun(userId);
    assert.ok(second?.leaseToken);
    assert.equal(await store.finish(second._id.toHexString(), second.leaseToken, 'no_result'), true);
    const promoted = await claim();
    assert.equal(promoted.trigger, 'manual');
    assert.equal(promoted.watermark.changedAt.getTime(), watermark(3).changedAt.getTime());
    // Replay follows the durable owner even when the successor's clock is behind.
    await NoteDiscoveryRun.collection.updateOne({ _id: promoted._id }, { $set: { createdAt: new Date(0) } });
    const replay = await store.enqueue(userId, watermark(3), 'M', { trigger: 'manual' });
    assert.equal(replay?._id.toHexString(), first._id.toHexString());
  });

  it('renews an active lease and fences out the previous holder after unsent recovery', async () => {
    await store.enqueue(userId, watermark(), 'unsent');
    const expired = await claim();
    now = watermark(500).changedAt;
    assert.equal(await store.renewLease(expired._id.toHexString(), expired.leaseToken), true);
    now = watermark(1_100).changedAt;
    assert.equal(await store.claimNext(now), null);
    now = watermark(1_600).changedAt;
    const recovered = await claim();
    assert.equal(recovered._id.toHexString(), expired._id.toHexString());
    assert.equal(recovered.generation, expired.generation + 1);
    assert.notEqual(recovered.leaseToken, expired.leaseToken);
    assert.equal(await store.isCurrentFence(fence(expired)), false);
    assert.equal(await store.isCurrentFence(fence(recovered)), true);
    assert.equal(await store.renewLease(expired._id.toHexString(), expired.leaseToken), false);
    assert.equal(await store.finish(expired._id.toHexString(), expired.leaseToken, 'completed'), false);
    const fresh = await budget.reserve(recovered._id.toHexString(), userId, recovered.generation, pricedCall);
    assert.ok(fresh);
    await budget.settle(fresh.id, expired.generation, { kind: 'known', inputTokens: 0, outputTokens: 0, costCnyMicros: 0 });
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.reservedTotalMicros, 10);
  });

  it('settles outstanding reservations before a replacement lease can book a new attempt', async () => {
    await store.enqueue(userId, watermark(), 'unconfirmed-reservations');
    const original = await claim();
    const reservations = await Promise.all(Array.from({ length: 4 }, () =>
      budget.reserve(original._id.toHexString(), userId, original.generation, pricedCall)));
    assert.ok(reservations.every(Boolean));
    now = watermark(1_001).changedAt;
    const replacement = await claim();
    assert.equal(replacement._id.toHexString(), original._id.toHexString());
    const ledger = await NoteDiscoveryBudget.findById('2026-11-18').lean();
    assert.equal(ledger?.spentTotalMicros, 40);
    assert.equal(ledger?.reservedTotalMicros, 0);
    assert.equal(await budget.reserve(replacement._id.toHexString(), userId, replacement.generation, pricedCall), null);
  });

  it('charges a sent expired attempt before promoting a later watermark and never replays the expired call', async () => {
    await store.enqueue(userId, watermark(), 'sent');
    const expired = await claim();
    const reservation = await budget.reserve(expired._id.toHexString(), userId, expired.generation, pricedCall);
    assert.ok(reservation);
    assert.equal(await store.markProviderStarted(fence(expired), reservation.id), true);
    assert.equal(await store.markProviderStarted(fence(expired), reservation.id), false);
    await store.enqueue(userId, watermark(1), 'later');
    now = watermark(1_001).changedAt;
    const next = await claim();
    assert.notEqual(next._id.toHexString(), expired._id.toHexString());
    assert.equal(next.idempotencyKey, 'later');
    assert.equal((await store.getRun(userId, expired._id.toHexString()))?.failureCategory, 'usage_unknown');
    const ledger = await NoteDiscoveryBudget.findById('2026-11-18').lean();
    assert.equal(ledger?.spentTotalMicros, 10);
    assert.equal(ledger?.reservedTotalMicros, 0);
    assert.equal(await store.finish(expired._id.toHexString(), expired.leaseToken, 'completed'), false);
    await budget.settle(reservation.id, expired.generation, { kind: 'known', inputTokens: 0, outputTokens: 0, costCnyMicros: 0 });
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.spentTotalMicros, 10);
  });

  it('settles the original generation if the first recovery worker crashes before settlement', async () => {
    await store.enqueue(userId, watermark(), 'first');
    const original = await claim();
    const originalFence = fence(original);
    const reservation = await budget.reserve(originalFence.runId, userId, original.generation, pricedCall);
    assert.ok(reservation);
    assert.equal(await store.markProviderStarted(originalFence, reservation.id), true);
    await store.enqueue(userId, watermark(1), 'next');
    await NoteDiscoveryRun.updateOne({ _id: original._id }, {
      $set: { recoveringGeneration: original.generation, leaseUntil: watermark(2_000).changedAt, leaseToken: 'interrupted' },
      $inc: { generation: 1 },
    });
    now = watermark(2_001).changedAt;
    const next = await claim();
    assert.equal(next.idempotencyKey, 'next');
    assert.equal(await store.isCurrentFence(originalFence), false);
    const failed = await store.getRun(userId, originalFence.runId);
    assert.equal(failed?.generation, original.generation + 2);
    assert.equal(failed?.status, 'failed');
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.spentTotalMicros, 10);
  });

  it('retries interrupted disabled recovery against the original reservation generation without requeue', async () => {
    await store.enqueue(userId, watermark(), 'disabled-crash');
    const original = await claim();
    const reservation = await budget.reserve(original._id.toHexString(), userId, original.generation, pricedCall);
    assert.ok(reservation);
    await store.enqueue(userId, watermark(1), 'disabled-successor', {trigger:'manual'});
    now = watermark(1_001).changedAt;
    const settle = budget.settleExpiredGeneration.bind(budget);
    budget.settleExpiredGeneration = async () => { throw new Error('synthetic settlement outage'); };
    await store.cancelAllQueued();
    await assert.rejects(store.recoverExpiredRuns(), /synthetic settlement outage/);
    const interrupted = await store.getRun(userId, original._id.toHexString());
    assert.equal(interrupted?.status, 'running');
    assert.equal(interrupted?.recoveringGeneration, original.generation);
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.reservedTotalMicros, 10);
    budget.settleExpiredGeneration = settle;
    now = watermark(2_002).changedAt;
    await store.recoverExpiredRuns();
    const terminal = await store.getRun(userId, original._id.toHexString());
    assert.equal(terminal?.status, 'cancelled');
    assert.equal(terminal?.generation, original.generation + 2);
    assert.equal(terminal?.recoveringGeneration, null);
    assert.equal(terminal?.pendingWatermark, undefined);
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.reservedTotalMicros, 0);
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.spentTotalMicros, 10);
    assert.equal(await store.claimNext(), null);
  });

  it('authorizes one send per reservation and a retry only after a fresh reservation', async () => {
    await store.enqueue(userId, watermark(), 'retry');
    const running = await claim();
    const current = fence(running);
    const reservation = await budget.reserve(current.runId, userId, current.generation, pricedCall);
    assert.ok(reservation);
    const starts = await Promise.all(Array.from({ length: 12 }, () => store.markProviderStarted(current, reservation.id)));
    assert.equal(starts.filter(Boolean).length, 1);
    assert.equal(await store.incrementRetry(current), false);
    assert.equal(await store.finish(current.runId, current.leaseToken, 'completed'), false);
    assert.equal(await store.markProviderFinished(current, reservation.id), false);
    await budget.settle(reservation.id, current.generation, {
      kind: 'known', inputTokens: 3, outputTokens: 2, costCnyMicros: 5,
    }, 'response_received');
    assert.equal(await store.markProviderFinished(current, reservation.id), true);
    assert.equal(await store.markProviderStarted(current, reservation.id), false);
    assert.equal(await store.incrementRetry(current), true);
    assert.equal(await store.incrementRetry(current), false);
    const retry = await budget.reserve(current.runId, userId, current.generation, pricedCall);
    assert.ok(retry);
    assert.notEqual(retry.id, reservation.id);
    assert.equal(await store.markProviderStarted(current, retry.id), true);
    await budget.settle(retry.id, current.generation, { kind: 'unknown', reason: 'unconfirmed send' });
    assert.equal(await store.markProviderFinished(current, retry.id), true);
    assert.equal(await store.finish(current.runId, current.leaseToken, 'failed', {
      failureCategory: 'usage_unknown',
      usage: { modelCalls: 2, toolCalls: 0, notesRead: 0, inputTokens: null, outputTokens: null, costCnyMicros: null },
    }), true);
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.spentTotalMicros, 15);
  });

  it('blocks a fresh dispatch on an uncertain send even with a reservation made earlier', async () => {
    await store.enqueue(userId, watermark(), 'unknown-delivery');
    const current = fence(await claim());
    const first = await budget.reserve(current.runId, userId, current.generation, pricedCall);
    const alreadyReserved = await budget.reserve(current.runId, userId, current.generation, pricedCall);
    assert.ok(first && alreadyReserved);
    assert.equal(await store.markProviderStarted(current, first.id), true);
    await budget.settle(first.id, current.generation, { kind: 'unknown', reason: 'response timed out' });
    assert.equal(await store.markProviderFinished(current, first.id), true);
    const restarted = new NoteDiscoveryWorkerStore({ budget, now: () => now });
    assert.equal((await restarted.getRun(userId, current.runId))?.providerDeliveryUnknown, true);
    assert.equal(await restarted.incrementRetry(current), false);
    assert.equal(await budget.reserve(current.runId, userId, current.generation, pricedCall), null);
    assert.equal(await restarted.markProviderStarted(current, alreadyReserved.id), false);
  });

  it('keeps a confirmed response with unknown billing eligible for another bounded call', async () => {
    await store.enqueue(userId, watermark(), 'unknown-accounting');
    const current = fence(await claim());
    const first = await budget.reserve(current.runId, userId, current.generation, pricedCall);
    assert.ok(first);
    assert.equal(await store.markProviderStarted(current, first.id), true);
    await budget.settle(first.id, current.generation, { kind: 'unknown', reason: 'response omitted usage' }, 'response_received');
    assert.equal(await store.markProviderFinished(current, first.id), true);
    const next = await budget.reserve(current.runId, userId, current.generation, pricedCall);
    assert.ok(next);
    assert.equal(await store.markProviderStarted(current, next.id), true);
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.spentTotalMicros, 10);
  });

  it('checks the auto preference before leasing a previously queued run', async () => {
    await store.enqueue(userId, watermark(), 'queued-before-disabled');
    await NoteDiscoveryPreference.create({ userId: owner, automaticEnabled: false });
    assert.equal(await store.claimNext(now), null);
    assert.equal((await store.getLatestRun(userId))?.status, 'cancelled');
    assert.equal(await store.enqueue(userId, watermark(1), 'off'), null);
  });

  it('retains a pending manual request when a newer automatic watermark arrives and auto is disabled', async () => {
    await store.enqueue(userId, watermark(), 'automatic-run');
    const running = await claim();
    await store.enqueue(userId, watermark(1), 'manual-pending', { trigger: 'manual' });
    await store.enqueue(userId, watermark(2), 'automatic-change', { availableAt: watermark(5_000).changedAt });
    await NoteDiscoveryPreference.create({ userId: owner, automaticEnabled: false });
    assert.equal(await store.cancelQueued(userId), 0);
    assert.equal(await store.finish(running._id.toHexString(), running.leaseToken, 'cancelled'), true);
    const manual = await claim();
    assert.equal(manual.trigger, 'manual');
    assert.equal(manual.idempotencyKey, 'manual-pending');
    assert.equal(manual.watermark.changedAt.getTime(), watermark(2).changedAt.getTime());
    assert.equal(await store.isCurrentFence(fence(manual)), true);
    assert.equal(await store.finish(manual._id.toHexString(), manual.leaseToken, 'completed'), true);
  });

  it('promotes queued automatic work to manual without auto debounce or preference', async () => {
    const automatic = await store.enqueue(userId, watermark(5), 'automatic', { availableAt: watermark(5_000).changedAt });
    assert.ok(automatic);
    await NoteDiscoveryPreference.create({ userId: owner, automaticEnabled: false });
    const manual = await store.enqueue(userId, watermark(2), 'manual', { trigger: 'manual' });
    assert.equal(manual?._id.toHexString(), automatic._id.toHexString());
    assert.equal(await store.cancelQueued(userId), 0);
    assert.equal((await claim()).trigger, 'manual');
    assert.equal(manual?.watermark.changedAt.getTime(), watermark(5).changedAt.getTime());
  });

  it('keeps the running lease when cancelling queued work and drops its pending watermark', async () => {
    assert.equal(await store.hasEnabledPreference(userId), true);
    await store.enqueue(userId, watermark(), 'current');
    const running = await claim();
    await store.enqueue(userId, watermark(1), 'pending');
    await store.enqueue(otherUser, watermark(), 'other-queued');
    await NoteDiscoveryPreference.create({ userId: owner, automaticEnabled: false });
    assert.equal(await store.hasEnabledPreference(userId), false);
    await store.cancelQueued(userId);
    await store.cancelQueued(otherUser);
    assert.equal(await store.isCurrentFence(fence(running)), true);
    assert.equal((await store.getLatestRun(otherUser))?.status, 'cancelled');
    assert.equal((await store.getRun(userId, running._id.toHexString()))?.pendingWatermark, undefined);
    assert.equal(await store.finish(running._id.toHexString(), running.leaseToken, 'cancelled'), true);
    assert.equal(await store.claimNext(now), null);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import NoteDiscoveryBudget from '../models/NoteDiscoveryBudget';
import { createDiscoveryProvider } from '../services/noteDiscoveryProvider';
import { NoteDiscoveryWorker } from '../services/noteDiscoveryWorker';
import { DiscoveryReservationRecoveryError } from '../services/noteDiscoveryBudgetService';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';
import { fixturePrice, makeNote, makeRun, ownerId, providerResponse, scriptTransport } from './noteDiscoveryRunnerFixture';

describe('independent note discovery worker', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  before(async () => { cleanup = await connectNoteDiscoveryTestMongo('worker'); });
  after(async () => { await cleanup?.(); });

  test('persisted manual admission gates execution and terminal run usage is recorded', async () => {
    const fixture = await makeRun();
    await makeNote(fixture.userId);
    const { transport, calls } = scriptTransport(providerResponse({ type: 'no_result' }));
    const worker = new NoteDiscoveryWorker({
      ...fixture, enabled: () => true, agentOptions: { provider: createDiscoveryProvider(fixturePrice, transport)!, telemetry: false },
    });
    await worker.tick();
    const run = await fixture.store.getRun(fixture.userId, fixture.runId);
    assert.equal(run?.status, 'no_result');
    assert.equal(run?.usage?.modelCalls, 1);
    assert.equal(run?.usage?.costCnyMicros, 680);
    assert.equal(calls.length, 1);
    const second = await fixture.schedule.requestManual(fixture.userId, 'immediately-after-completion');
    assert.equal(second.status, 'limited');
  });

  test('long transport outlives the original lease under heartbeat', async () => {
    const fixture = await makeRun(ownerId(), { leaseMs: 450 });
    await makeNote(fixture.userId);
    const worker = new NoteDiscoveryWorker({
      ...fixture, enabled: () => true, heartbeatMs: 35,
      agentOptions: { telemetry: false, provider: createDiscoveryProvider(fixturePrice, async ({ signal }) => {
        await delay(600, undefined, { signal });
        assert.equal(await fixture.store.claimNext(), null);
        return providerResponse({ type: 'no_result' });
      })! },
    });
    await worker.tick();
    assert.equal((await fixture.store.getRun(fixture.userId, fixture.runId))?.status, 'no_result');
  });

  test('loss of lease aborts an in-flight request and cannot overwrite the successor', async () => {
    let clock = new Date();
    const fixture = await makeRun(ownerId(), { leaseMs: 5_000, now: () => clock });
    await makeNote(fixture.userId);
    let aborted = false;
    const worker = new NoteDiscoveryWorker({
      ...fixture, enabled: () => true, heartbeatMs: 10,
      agentOptions: { telemetry: false, provider: createDiscoveryProvider(fixturePrice, ({ signal }) => new Promise((_, reject) => {
        clock = new Date(clock.getTime() + 5_001);
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('transport stopped')); }, { once: true });
      }))! },
    });
    await worker.tick();
    assert.equal(aborted, true);
    assert.equal(await fixture.store.claimNext(), null);
    const run = await fixture.store.getRun(fixture.userId, fixture.runId);
    assert.equal(run?.generation, 2);
    assert.equal(run?.status, 'failed');
    assert.equal(run?.failureCategory, 'usage_unknown');
  });

  test('global disable durably cancels both queued triggers and removes pending work', async () => {
    const manual = await makeRun();
    const auto = await manual.store.enqueue(ownerId(), { changedAt: new Date() }, 'automatic', { trigger: 'automatic' });
    const runningOwner = ownerId();
    const running = await NoteDiscoveryRun.create({
      userId: runningOwner, trigger: 'manual', idempotencyKey: 'running', watermark: { changedAt: new Date() },
      status: 'running', generation: 1, leaseToken: '1:ea2e1b69-e3d3-452e-b712-84be28047a14', leaseUntil: new Date(Date.now() + 30000),
      pendingWatermark: { changedAt: new Date() }, pendingIdempotencyKey: 'pending', pendingTrigger: 'manual',
    });
    const worker = new NoteDiscoveryWorker({ ...manual, enabled: () => false });
    await worker.tick();
    assert.equal((await manual.store.getRun(manual.userId, manual.runId))?.status, 'cancelled');
    assert.equal((await NoteDiscoveryRun.findById(auto?._id).lean())?.status, 'cancelled');
    const current = await NoteDiscoveryRun.findById(running._id).lean();
    assert.equal(current?.status, 'running');
    assert.equal(current?.pendingWatermark, undefined);
    await manual.store.finish(String(running._id), running.leaseToken!, 'cancelled');
  });

  test('scheduler-blocked automatic admission never invokes the runner or finishes the cancelled lease twice', async () => {
    const fixture = await makeRun();
    const original = await fixture.store.claimNext();
    assert.ok(original);
    await fixture.store.finish(fixture.runId, original.leaseToken, 'failed');
    const row = await fixture.store.enqueue(fixture.userId, {
      ...original.watermark, noteId: original.watermark.noteId?.toHexString(),
    }, 'legacy-promoted', { trigger: 'automatic' });
    assert.ok(row);
    await NoteDiscoveryRun.updateOne({ _id: fixture.runId }, { $set: { providerDeliveryUnknown: true } });
    const { transport, calls } = scriptTransport();
    const worker = new NoteDiscoveryWorker({
      ...fixture, enabled: () => true,
      agentOptions: { telemetry: false, provider: createDiscoveryProvider(fixturePrice, transport)! },
    });
    await worker.tick();
    assert.equal((await fixture.store.getRun(fixture.userId, String(row._id)))?.status, 'cancelled');
    assert.equal(calls.length, 0);
  });

  test('limited admission leaves the deferred run queued and does not invoke the provider', async () => {
    const first = await makeRun();
    const original = await first.store.claimNext();
    assert.ok(original);
    assert.equal((await first.schedule.authorizeRun(original)).status, 'authorized');
    assert.equal(await first.store.finish(first.runId, original.leaseToken, 'no_result'), true);
    const next = await first.store.enqueue(first.userId, { changedAt: new Date() }, 'forced-manual', { trigger: 'manual' });
    assert.ok(next);
    const { transport, calls } = scriptTransport();
    const worker = new NoteDiscoveryWorker({
      ...first, enabled: () => true,
      agentOptions: { provider: createDiscoveryProvider(fixturePrice, transport)!, telemetry: false },
    });
    await worker.tick();
    const row = await first.store.getRun(first.userId, next._id.toHexString());
    assert.equal(row?.status, 'queued');
    assert.equal(row?.leaseToken, null);
    assert.equal(calls.length, 0);
  });

  test('automatic off during a known response cancels the run at its next boundary', async () => {
    const fixture = await makeRun();
    const original = await fixture.store.claimNext();
    assert.ok(original);
    await fixture.store.finish(fixture.runId, original.leaseToken, 'cancelled');
    await makeNote(fixture.userId);
    const run = await fixture.store.enqueue(fixture.userId, { changedAt: new Date() }, 'explicit-automatic-test');
    assert.ok(run);
    let requests = 0;
    const worker = new NoteDiscoveryWorker({
      ...fixture, enabled: () => true,
      agentOptions: { telemetry: false, provider: createDiscoveryProvider(fixturePrice, async () => {
        requests++;
        await fixture.schedule.setAutomaticEnabled(fixture.userId, false);
        return providerResponse({ type: 'no_result' });
      })! },
    });
    await worker.tick();
    const saved = await fixture.store.getRun(fixture.userId, run._id.toHexString());
    assert.equal(saved?.status, 'cancelled');
    assert.equal(saved?.usage?.modelCalls, 1);
    assert.equal(saved?.providerDeliveryUnknown, undefined);
    assert.equal(requests, 1);
  });

  for (const paused of ['reservation', 'marker', 'retry'] as const) {
    test(`deadline frees the worker while a provider ${paused} acknowledgement is pending`, { timeout: 5000 }, async context => {
      const fixture = await makeRun();
      await makeNote(fixture.userId);
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      let notify!: () => void;
      const entered = new Promise<void>(resolve => { notify = resolve; });
      if (paused === 'reservation') {
        const reserve = fixture.budget.reserve.bind(fixture.budget);
        context.mock.method(fixture.budget, 'reserve', async (...args: Parameters<typeof reserve>) => {
          const reservation = await reserve(...args);
          notify();
          await waiting;
          return reservation;
        });
      } else if (paused === 'marker') {
        const mark = fixture.store.markProviderStarted.bind(fixture.store);
        context.mock.method(fixture.store, 'markProviderStarted', async (...args: Parameters<typeof mark>) => {
          assert.equal(await mark(...args), true);
          notify();
          await waiting;
          throw new Error('simulated lost marker acknowledgement');
        });
      } else {
        const increment = fixture.store.incrementRetry.bind(fixture.store);
        context.mock.method(fixture.store, 'incrementRetry', async (...args: Parameters<typeof increment>) => {
          notify();
          await waiting;
          return increment(...args);
        });
      }
      let requests = 0;
      const worker = new NoteDiscoveryWorker({
        ...fixture, enabled: () => true, heartbeatMs: 30,
        agentOptions: { limits: { timeoutMs: 250 }, telemetry: false, provider: createDiscoveryProvider(fixturePrice, async () => {
          requests++;
          return { status: 503, data: { usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } } };
        })! },
      });
      const ticking = worker.tick();
      try {
        await entered;
        assert.equal(await Promise.race([ticking.then(() => 'released'), delay(500, 'blocked')]), 'released');
      } finally {
        release();
        await ticking;
      }
      for (let i = 0; i < 50; i++) {
        if ((await fixture.store.getRun(fixture.userId, fixture.runId))?.status === 'failed') break;
        await delay(10);
      }
      const row = await fixture.store.getRun(fixture.userId, fixture.runId);
      const ledger = await NoteDiscoveryBudget.findOne({ 'reservations.runId': fixture.runId }).lean();
      const reservation = ledger?.reservations.find(item => String(item.runId) === fixture.runId);
      assert.equal(row?.status, 'failed');
      assert.equal(row?.failureCategory, 'limit_exceeded');
      assert.equal(row?.providerReservationId, null);
      assert.equal(row?.providerDeliveryUnknown, undefined);
      assert.equal(requests, paused === 'retry' ? 1 : 0);
      assert.equal(reservation?.state, 'settled');
      assert.equal(reservation?.delivery, paused === 'retry' ? 'response_received' : 'not_sent');
      if (paused !== 'retry') assert.equal(reservation?.settledMicros, 0);
    });
  }

  for (const cleanup of ['acknowledged', 'lost-on-shutdown'] as const) {
    test(`external abort preserves pending reservation cleanup when ${cleanup}`, { timeout: 5000 }, async context => {
      let clock = new Date();
      const fixture = await makeRun(ownerId(), { now: () => clock, leaseMs: 5000 });
      await makeNote(fixture.userId);
      const controller = new AbortController();
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      let notify!: () => void;
      const entered = new Promise<void>(resolve => { notify = resolve; });
      const reserve = fixture.budget.reserve.bind(fixture.budget);
      context.mock.method(fixture.budget, 'reserve', async (...args: Parameters<typeof reserve>) => {
        const reservation = await reserve(...args);
        assert.ok(reservation);
        notify();
        await waiting;
        return reservation;
      });
      if (cleanup === 'lost-on-shutdown') {
        // A disconnected process cannot refund its committed reservation.
        context.mock.method(fixture.budget, 'releaseUnsent', async () => {
          throw new DiscoveryReservationRecoveryError();
        });
      }
      const { transport, calls } = scriptTransport();
      const worker = new NoteDiscoveryWorker({
        ...fixture, enabled: () => true, heartbeatMs: 30,
        agentOptions: { provider: createDiscoveryProvider(fixturePrice, transport)!, telemetry: false },
      });
      const ticking = worker.tick(controller.signal);
      let pendingStatus: string | undefined;
      try {
        await entered;
        controller.abort();
        assert.equal(await Promise.race([ticking.then(() => 'released'), delay(500, 'blocked')]), 'released');
        pendingStatus = (await fixture.store.getRun(fixture.userId, fixture.runId))?.status;
      } finally {
        release();
        await ticking;
      }
      assert.equal(pendingStatus, 'running', 'a terminal run would be invisible to expired-lease recovery');
      if (cleanup === 'acknowledged') {
        for (let i = 0; i < 50; i++) {
          if ((await fixture.store.getRun(fixture.userId, fixture.runId))?.status === 'cancelled') break;
          await delay(10);
        }
        assert.equal((await fixture.store.getRun(fixture.userId, fixture.runId))?.status, 'cancelled');
      } else {
        clock = new Date(clock.getTime() + 5001);
        const recovered = await fixture.store.claimNext();
        assert.equal(recovered?._id.toHexString(), fixture.runId);
        assert.equal(recovered?.generation, 2);
        assert.equal(await fixture.store.finish(fixture.runId, recovered!.leaseToken, 'cancelled'), true);
      }
      const ledger = await NoteDiscoveryBudget.findOne({ 'reservations.runId': fixture.runId }).lean();
      const reservation = ledger?.reservations.find(item => String(item.runId) === fixture.runId);
      assert.equal(reservation?.state, 'settled');
      assert.equal(reservation?.delivery, cleanup === 'acknowledged' ? 'not_sent' : 'delivery_unknown');
      assert.equal(reservation?.settledMicros, cleanup === 'acknowledged' ? 0 : reservation?.reservedMicros);
      assert.equal(calls.length, 0);
      assert.equal(ledger?.reservedTotalMicros, 0);
    });
  }
});

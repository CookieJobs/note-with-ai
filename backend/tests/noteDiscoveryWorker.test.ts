import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import { createDiscoveryProvider } from '../services/noteDiscoveryProvider';
import { NoteDiscoveryWorker } from '../services/noteDiscoveryWorker';
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
});

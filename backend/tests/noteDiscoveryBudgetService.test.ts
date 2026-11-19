import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import NoteDiscoveryBudget from '../models/NoteDiscoveryBudget';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import { NoteDiscoveryBudgetService, type CostEstimate } from '../services/noteDiscoveryBudgetService';
import { NoteDiscoveryWorkerStore } from '../services/noteDiscoveryWorkerStore';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

const pricedCall: CostEstimate = {
  provider: 'test-provider',
  model: 'test-model',
  inputCnyPerMillion: '0.7',
  outputCnyPerMillion: '1.3',
  maxInputTokens: 10,
  maxOutputTokens: 10,
};
const limits = { enabled: true, userCapMicros: 40, globalCapMicros: 60, attemptCapMicros: 30 };

describe('discovery budget on MongoDB', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  let now: Date;
  let budget: NoteDiscoveryBudgetService;
  let store: NoteDiscoveryWorkerStore;

  before(async () => {
    cleanup = await connectNoteDiscoveryTestMongo('budget');
    await Promise.all([NoteDiscoveryBudget.init(), NoteDiscoveryRun.init()]);
  });
  after(async () => { await cleanup?.(); });
  beforeEach(async () => {
    now = new Date('2026-11-18T23:59:59.000Z');
    budget = new NoteDiscoveryBudgetService(limits, () => now);
    store = new NoteDiscoveryWorkerStore({ budget, now: () => now, leaseMs: 120_000 });
    await Promise.all([NoteDiscoveryBudget.deleteMany({}), NoteDiscoveryRun.deleteMany({})]);
  });

  async function claimedRun() {
    const user = new Types.ObjectId().toHexString();
    await store.enqueue(user, { changedAt: now }, 'first');
    const run = await store.claimNext(now);
    assert.ok(run);
    assert.equal(run.userId.toHexString(), user);
    return { id: run._id.toHexString(), user, generation: run.generation };
  }

  it('limits simultaneous reservations for one owner and across owners', async () => {
    const first = await claimedRun();
    const second = await claimedRun();
    const reservedByFirst = (await Promise.all(Array.from({ length: 12 }, () =>
      budget.reserve(first.id, first.user, first.generation, pricedCall)))).filter(Boolean);
    assert.equal(reservedByFirst.length, 2);
    const reservedBySecond = (await Promise.all(Array.from({ length: 12 }, () =>
      budget.reserve(second.id, second.user, second.generation, pricedCall)))).filter(Boolean);
    assert.equal(reservedBySecond.length, 1);
    const ledger = await NoteDiscoveryBudget.findById('2026-11-18').lean();
    assert.equal(ledger?.reservedTotalMicros, 60);
    assert.equal(ledger?.reservations.length, 3);
    assert.equal(new Set(ledger?.reservations.map(({ id }) => id)).size, 3);
  });

  it('applies the global cap when different owners reserve concurrently', async () => {
    const runs = await Promise.all(Array.from({ length: 5 }, async () => {
      const userId = new Types.ObjectId().toHexString();
      return store.enqueue(userId, { changedAt: now }, 'same-key-across-owners');
    }));
    assert.ok(runs.every(Boolean));
    const claims = await Promise.all(runs.map(() => store.claimNext(now)));
    assert.equal(claims.filter(Boolean).length, 5);
    const results = await Promise.all(claims.map((run) => budget.reserve(
      run!._id.toHexString(), run!.userId.toHexString(), run!.generation, pricedCall,
    )));
    assert.equal(results.filter(Boolean).length, 3);
    assert.equal((await NoteDiscoveryBudget.findById('2026-11-18').lean())?.reservedTotalMicros, 60);
  });

  it('fails closed for absent or invalid rates, bounds, identity and caps', async () => {
    const run = await claimedRun();
    const invalid = [
      { inputCnyPerMillion: undefined },
      { inputCnyPerMillion: ' ' },
      { outputCnyPerMillion: null },
      { outputCnyPerMillion: Infinity },
      { provider: ' ' },
      { model: '' },
      { maxInputTokens: Number.MAX_SAFE_INTEGER + 1 },
      { maxInputTokens: 1.5 },
      { maxOutputTokens: -1 },
      { outputCnyPerMillion: '3' }, // 37 micros exceeds the configured attempt cap.
    ];
    for (const fields of invalid) {
      const result = await budget.reserve(run.id, run.user, run.generation, { ...pricedCall, ...fields } as CostEstimate);
      assert.equal(result, null, JSON.stringify(fields));
    }
    const unconfigured = new NoteDiscoveryBudgetService({ ...limits, userCapMicros: undefined }, () => now);
    assert.equal(await unconfigured.reserve(run.id, run.user, run.generation, pricedCall), null);
    assert.equal(await NoteDiscoveryBudget.countDocuments(), 0);
  });

  it('rounds the exact sum up and permits an explicitly free provider', async () => {
    const { id, user, generation } = await claimedRun();
    const a = await budget.reserve(id, user, generation, {
      ...pricedCall, inputCnyPerMillion: '0.07', outputCnyPerMillion: '0.03',
    });
    assert.equal(a?.reservedMicros, 1);
    const b = await budget.reserve(id, user, generation, {
      ...pricedCall, inputCnyPerMillion: 0, outputCnyPerMillion: '0',
    });
    assert.equal(b?.reservedMicros, 0);
    const c = await budget.reserve(id, user, generation, {
      ...pricedCall, inputCnyPerMillion: 1e-12, outputCnyPerMillion: '0',
    });
    assert.equal(c?.reservedMicros, 1);
  });

  it('charges unknown usage in full once and settles against the original UTC bucket', async () => {
    const { id, user, generation } = await claimedRun();
    const reservation = await budget.reserve(id, user, generation, pricedCall);
    assert.ok(reservation);
    now = new Date('2026-11-19T00:00:01.000Z');
    const usage = { kind: 'unknown', reason: 'missing provider usage' } as const;
    await Promise.all(Array.from({ length: 12 }, () => budget.settle(reservation.id, generation, usage)));
    const ledger = await NoteDiscoveryBudget.findById('2026-11-18').lean();
    assert.equal(ledger?.reservedTotalMicros, 0);
    assert.equal(ledger?.spentTotalMicros, 20);
    assert.equal(ledger?.reservations[0].state, 'settled');
    assert.equal(ledger?.reservations[0].settledMicros, 20);
    assert.equal(await NoteDiscoveryBudget.findById('2026-11-19'), null);
  });

  it('keeps consumed cost spent while releasing only the verified unconsumed portion', async () => {
    const { id, user, generation } = await claimedRun();
    const first = await budget.reserve(id, user, generation, pricedCall);
    assert.ok(first);
    await budget.settle(first.id, generation, { kind: 'known', inputTokens: 10, outputTokens: 0, costCnyMicros: 7 });
    const second = await budget.reserve(id, user, generation, pricedCall);
    assert.ok(second);
    assert.notEqual(first.id, second.id);
    assert.equal(await budget.reserve(id, user, generation, pricedCall), null);
    // A malformed "known" result has no authority to release money.
    await budget.settle(second.id, generation, { kind: 'known', inputTokens: NaN, outputTokens: 0, costCnyMicros: 0 });
    const ledger = await NoteDiscoveryBudget.findById('2026-11-18').lean();
    assert.equal(ledger?.spentTotalMicros, 27);
    assert.equal(ledger?.reservedTotalMicros, 0);
    assert.equal(await budget.reserve(id, user, generation, pricedCall), null);
  });

  it('records an overage and blocks further reservations, including after the UTC rollover', async () => {
    const { id, user, generation } = await claimedRun();
    const reservation = await budget.reserve(id, user, generation, pricedCall);
    assert.ok(reservation);
    await assert.rejects(budget.settle(reservation.id, generation, {
      kind: 'known', inputTokens: 10, outputTokens: 10, costCnyMicros: 21,
    }), { name: 'DiscoveryBudgetOverrunError' });
    const ledger = await NoteDiscoveryBudget.findById('2026-11-18').lean();
    assert.equal(ledger?.spentTotalMicros, 21);
    assert.equal(ledger?.reservedTotalMicros, 0);
    assert.equal(await budget.reserve(id, user, generation, pricedCall), null);
    now = new Date('2026-11-19T00:00:01.000Z');
    assert.equal(await budget.reserve(id, user, generation, pricedCall), null);
  });

  it('rejects owner or generation mismatches before reserving or settling', async () => {
    const { id, user, generation } = await claimedRun();
    assert.equal(await budget.reserve(id, new Types.ObjectId().toHexString(), generation, pricedCall), null);
    assert.equal(await budget.reserve(id, user, generation - 1, pricedCall), null);
    const reservation = await budget.reserve(id, user, generation, pricedCall);
    assert.ok(reservation);
    await budget.settle(reservation.id, generation - 1, { kind: 'unknown', reason: 'wrong generation' });
    const ledger = await NoteDiscoveryBudget.findById('2026-11-18').lean();
    assert.equal(ledger?.reservedTotalMicros, 20);
    assert.equal(ledger?.spentTotalMicros, 0);
  });

  it('fails closed for the reservation count and BSON size independently', async () => {
    const { id, user, generation } = await claimedRun();
    await NoteDiscoveryBudget.collection.insertOne({
      _id: '2026-11-18', reservedTotalMicros: 0, spentTotalMicros: 0, users: {},
      reservations: Array.from({ length: 10_000 }, (_, index) => ({ id: String(index) })),
    } as never);
    assert.equal(await budget.reserve(id, user, generation, pricedCall), null);
    await NoteDiscoveryBudget.deleteMany({});
    await NoteDiscoveryBudget.collection.insertOne({
      _id: '2026-11-18', reservedTotalMicros: 0, spentTotalMicros: 0, users: {},
      reservations: [], padding: 'x'.repeat(8 * 1024 * 1024),
    } as never);
    assert.equal(await budget.reserve(id, user, generation, pricedCall), null);
    assert.equal(await NoteDiscoveryBudget.countDocuments(), 1);
  });
});

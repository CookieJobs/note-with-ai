import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInspirationWorker, type InspirationWorkerStore, type WorkerRun, type WorkerSlot } from '../services/inspirationWorker';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const start = new Date('2026-09-26T00:00:00.000Z');

class FakeStore implements InspirationWorkerStore {
  users = new Map<string, { enabled: boolean; next: Date; lastStatus: string | null }>();
  runs = new Map<string, WorkerRun>();
  slots = new Set<number>();
  budget = new Map<string, number>();
  constructor(readonly concurrency = 2, readonly dailyLimit = 20) {}
  add(userId: string, next: Date, enabled = true) { this.users.set(userId, { enabled, next, lastStatus: null }); }
  async scanDue(now: Date): Promise<string[]> {
    return [...this.users].filter(([, value]) => value.enabled && value.next <= now).map(([userId]) => userId);
  }
  async claimDue(userId: string, now: Date): Promise<WorkerRun | null> {
    const user = this.users.get(userId);
    if (!user?.enabled || user.next > now) return null;
    const cycleAt = user.next;
    user.next = new Date(now.getTime() + DAY);
    const run = { id: `${userId}-${cycleAt.toISOString()}`, userId, cycleAt, state: 'claimed' as const, token: `${userId}-${Math.random()}` };
    this.runs.set(run.id, run);
    return run;
  }
  async recover(now: Date): Promise<WorkerRun[]> {
    const pending: WorkerRun[] = [];
    for (const run of this.runs.values()) {
      if (run.state === 'provider_started' && run.leaseUntil && run.leaseUntil <= now) {
        run.state = 'failed';
        this.users.get(run.userId)!.lastStatus = 'failed';
      } else if ((run.state === 'claimed' || run.state === 'queued') && run.leaseUntil && run.leaseUntil <= now) {
        run.state = 'claimed';
        run.token = `${run.token}-recovered`;
        run.leaseUntil = new Date(now.getTime() + 20 * 60_000);
        pending.push(run);
      }
    }
    return pending;
  }
  async acquireSlot(): Promise<WorkerSlot | null> {
    for (let slot = 0; slot < this.concurrency; slot++) {
      if (!this.slots.has(slot)) { this.slots.add(slot); return { slot, token: `slot-${slot}` }; }
    }
    return null;
  }
  async releaseSlot(slot: WorkerSlot): Promise<void> { this.slots.delete(slot.slot); }
  async reserveBudget(now: Date): Promise<boolean> {
    const day = now.toISOString().slice(0, 10);
    const count = this.budget.get(day) || 0;
    if (count >= this.dailyLimit) return false;
    this.budget.set(day, count + 1);
    return true;
  }
  async refundBudget(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    this.budget.set(day, Math.max(0, (this.budget.get(day) || 0) - 1));
  }
  async defer(userId: string, next: Date): Promise<void> {
    const user = this.users.get(userId)!;
    user.next = next;
    user.lastStatus = 'deferred';
  }
  async markProviderStarted(run: WorkerRun): Promise<boolean> {
    const current = this.runs.get(run.id);
    if (!current || current.token !== run.token) return false;
    current.state = 'provider_started';
    return true;
  }
  async finish(run: WorkerRun, status: 'completed' | 'no_result' | 'failed' | 'cancelled'): Promise<void> {
    const current = this.runs.get(run.id);
    if (current?.token !== run.token) return;
    current.state = status;
    this.users.get(run.userId)!.lastStatus = status;
  }
}

describe('durable inspiration worker', () => {
  it('does not call providers for disabled users or before their first 24 hours', async () => {
    const store = new FakeStore();
    store.add('off', new Date(start.getTime() - DAY), false);
    store.add('early', new Date(start.getTime() + DAY));
    let calls = 0;
    const worker = createInspirationWorker({ store, runResearch: async () => { calls++; return { status: 'no_result' }; } });
    await worker.tick(start);
    assert.equal(calls, 0);
    await worker.tick(new Date(start.getTime() + DAY));
    assert.equal(calls, 1);
  });

  it('two instances claim one due user once and do not retry no-result within 24 hours', async () => {
    const store = new FakeStore();
    store.add('user-1', start);
    let calls = 0;
    const research = async (_userId: string, canContinue: () => Promise<boolean>) => {
      assert.equal(await canContinue(), true);
      calls++;
      return { status: 'no_result' as const };
    };
    const workerA = createInspirationWorker({ store, runResearch: research });
    const workerB = createInspirationWorker({ store, runResearch: research });
    await Promise.all([workerA.tick(start), workerB.tick(start)]);
    await workerA.tick(new Date(start.getTime() + HOUR));
    assert.equal(calls, 1);
    assert.equal(store.users.get('user-1')?.lastStatus, 'no_result');
    assert.equal(store.budget.get('2026-09-26'), 1);
  });

  it('never exceeds two global jobs or the UTC daily attempt limit', async () => {
    const store = new FakeStore(2, 2);
    for (const id of ['u1', 'u2', 'u3']) store.add(id, start);
    let active = 0;
    let maxActive = 0;
    const research = async (_userId: string, canContinue: () => Promise<boolean>) => {
      assert.equal(await canContinue(), true);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return { status: 'no_result' as const };
    };
    await Promise.all([
      createInspirationWorker({ store, runResearch: research }).tick(start),
      createInspirationWorker({ store, runResearch: research }).tick(start),
    ]);
    assert.ok(maxActive <= 2);
    assert.equal(store.budget.get('2026-09-26'), 2);
    assert.equal(store.users.get('u3')?.lastStatus, 'deferred');
  });

  it('recovers a pre-provider claim but never repeats an expired provider-started cycle', async () => {
    const store = new FakeStore();
    store.add('user-1', new Date(start.getTime() + DAY));
    const old = new Date(start.getTime() - HOUR);
    const resumable: WorkerRun = { id: 'r1', userId: 'user-1', cycleAt: old, state: 'claimed', token: 'old', leaseUntil: old };
    const paid: WorkerRun = { id: 'r2', userId: 'user-1', cycleAt: old, state: 'provider_started', token: 'old2', leaseUntil: old };
    store.runs.set('r1', resumable);
    store.runs.set('r2', paid);
    let calls = 0;
    const worker = createInspirationWorker({ store, runResearch: async (_id, canContinue) => {
      if (await canContinue()) calls++;
      return { status: 'created' };
    } });
    await worker.tick(start);
    assert.equal(calls, 1);
    assert.equal(store.runs.get('r1')?.state, 'completed');
    assert.equal(store.runs.get('r2')?.state, 'failed');
  });
});

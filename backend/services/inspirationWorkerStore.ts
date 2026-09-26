import { randomUUID } from 'node:crypto';
import InspirationSettings from '../models/InspirationSettings';
import InspirationRun from '../models/InspirationRun';
import InspirationDailyBudget from '../models/InspirationDailyBudget';
import InspirationWorkerSlot from '../models/InspirationWorkerSlot';
import { config } from '../config';
import type { InspirationWorkerStore, WorkerRun, WorkerSlot } from './inspirationWorker';

const DAY_MS = 86_400_000;
const LEASE_MS = 20 * 60_000;

type RunRecord = {
  _id: unknown; userId: unknown; cycleAt: Date; attemptAt: Date; state: WorkerRun['state'];
  token: string; leaseUntil?: Date;
};

function toRun(record: RunRecord): WorkerRun {
  return {
    id: String(record._id), userId: String(record.userId), cycleAt: record.cycleAt,
    attemptAt: record.attemptAt, state: record.state, token: record.token,
    leaseUntil: record.leaseUntil,
  };
}

function dayKey(now: Date): string { return now.toISOString().slice(0, 10); }

async function ensureDocument(model: typeof InspirationDailyBudget | typeof InspirationWorkerSlot, filter: Record<string, unknown>, defaults: Record<string, unknown>) {
  try {
    await model.updateOne(filter, { $setOnInsert: defaults }, { upsert: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
}

export class MongoInspirationWorkerStore implements InspirationWorkerStore {
  async scanDue(now: Date): Promise<string[]> {
    const settings = await InspirationSettings.find({ enabled: true, nextEligibleAt: { $lte: now } })
      .sort({ nextEligibleAt: 1, _id: 1 }).limit(100).select('userId').lean() as unknown as Array<{ userId: unknown }>;
    return settings.map((setting) => String(setting.userId));
  }

  async claimDue(userId: string, now: Date): Promise<WorkerRun | null> {
    const previous = await InspirationSettings.findOneAndUpdate(
      { userId, enabled: true, nextEligibleAt: { $lte: now } },
      { $set: { lastAttemptAt: now, nextEligibleAt: new Date(now.getTime() + DAY_MS), lastStatus: 'failed' } },
      { new: false },
    ) as unknown as { nextEligibleAt: Date } | null;
    if (!previous) return null;
    const cycleAt = previous.nextEligibleAt;
    let queued;
    try {
      queued = await InspirationRun.findOneAndUpdate(
        { userId, cycleAt },
        { $setOnInsert: { userId, cycleAt, attemptAt: now, budgetDay: dayKey(now), state: 'queued' } },
        { upsert: true, new: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      queued = await InspirationRun.findOne({ userId, cycleAt });
    }
    if (!queued) return null;
    const token = randomUUID();
    const claimed = await InspirationRun.findOneAndUpdate(
      { _id: queued._id, state: 'queued' },
      { $set: { state: 'claimed', token, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
      { new: true },
    );
    return claimed ? toRun(claimed as unknown as RunRecord) : null;
  }

  async recover(now: Date): Promise<WorkerRun[]> {
    const expiredPaid = await InspirationRun.find({ state: 'provider_started', leaseUntil: { $lte: now } })
      .limit(100).lean() as unknown as RunRecord[];
    for (const run of expiredPaid) {
      const result = await InspirationRun.updateOne(
        { _id: run._id, state: 'provider_started', token: run.token },
        { $set: { state: 'failed', leaseUntil: null } },
      );
      if (result.modifiedCount) {
        await InspirationSettings.updateOne(
          { userId: run.userId, lastAttemptAt: run.attemptAt }, { $set: { lastStatus: 'failed' } },
        );
      }
    }
    const candidates = await InspirationRun.find({
      $or: [{ state: 'queued' }, { state: 'claimed', leaseUntil: { $lte: now } }],
    }).sort({ cycleAt: 1 }).limit(100).lean() as unknown as RunRecord[];
    const recovered: WorkerRun[] = [];
    for (const run of candidates) {
      const token = randomUUID();
      const claimed = await InspirationRun.findOneAndUpdate(
        { _id: run._id, state: run.state, token: run.token },
        { $set: { state: 'claimed', token, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
        { new: true },
      );
      if (claimed) recovered.push(toRun(claimed as unknown as RunRecord));
    }
    return recovered;
  }

  async acquireSlot(now: Date): Promise<WorkerSlot | null> {
    for (let slot = 0; slot < config.INSPIRATION_AUTO_CONCURRENCY; slot++) {
      await ensureDocument(InspirationWorkerSlot, { slot }, { slot, token: null, leaseUntil: null });
      const token = randomUUID();
      const acquired = await InspirationWorkerSlot.findOneAndUpdate(
        { slot, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
        { $set: { token, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
        { new: true },
      );
      if (acquired) return { slot, token };
    }
    return null;
  }

  async releaseSlot(slot: WorkerSlot): Promise<void> {
    await InspirationWorkerSlot.updateOne(
      { slot: slot.slot, token: slot.token }, { $set: { token: null, leaseUntil: null } },
    );
  }

  async reserveBudget(now: Date): Promise<boolean> {
    const day = dayKey(now);
    await ensureDocument(InspirationDailyBudget, { day }, { day, count: 0 });
    const reserved = await InspirationDailyBudget.findOneAndUpdate(
      { day, count: { $lt: config.INSPIRATION_AUTO_DAILY_LIMIT } },
      { $inc: { count: 1 } }, { new: true },
    );
    return Boolean(reserved);
  }

  async refundBudget(now: Date): Promise<void> {
    await InspirationDailyBudget.updateOne({ day: dayKey(now), count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async defer(userId: string, next: Date): Promise<void> {
    await InspirationSettings.updateOne(
      { userId, enabled: true },
      { $max: { nextEligibleAt: next }, $set: { lastStatus: 'deferred' } },
    );
  }

  async markProviderStarted(run: WorkerRun): Promise<boolean> {
    const updated = await InspirationRun.findOneAndUpdate(
      { _id: run.id, token: run.token, state: { $in: ['claimed', 'provider_started'] } },
      { $set: { state: 'provider_started' } }, { new: true },
    );
    return Boolean(updated);
  }

  async finish(run: WorkerRun, status: 'completed' | 'no_result' | 'failed' | 'cancelled'): Promise<void> {
    const result = await InspirationRun.updateOne(
      { _id: run.id, token: run.token, state: { $in: ['claimed', 'provider_started'] } },
      { $set: { state: status, leaseUntil: null } },
    );
    if (result.modifiedCount) {
      await InspirationSettings.updateOne(
        { userId: run.userId, lastAttemptAt: run.attemptAt }, { $set: { lastStatus: status } },
      );
    }
  }
}

export const mongoInspirationWorkerStore = new MongoInspirationWorkerStore();

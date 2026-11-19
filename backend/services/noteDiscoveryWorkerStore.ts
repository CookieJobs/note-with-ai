import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import NoteDiscoveryPreference from '../models/NoteDiscoveryPreference';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import type {
  DiscoveryFailureCategory, DiscoveryRunFence, DiscoveryRunRecord, DiscoveryRunStatus,
  DiscoveryRunUsage, DiscoveryTrigger, DiscoveryWatermark,
} from '../types/noteDiscovery';
import { noteDiscoveryBudgetService, type NoteDiscoveryBudgetService } from './noteDiscoveryBudgetService';

type StoredWatermark = DiscoveryWatermark<Types.ObjectId>;
export type StoredDiscoveryRun = DiscoveryRunRecord & { _id: Types.ObjectId };
export type ClaimedDiscoveryRun = StoredDiscoveryRun & { status: 'running'; leaseToken: string; leaseUntil: Date };
type FinishStatus = Exclude<DiscoveryRunStatus, 'queued' | 'running'>;

interface EnqueueOptions {
  availableAt?: Date;
  trigger?: DiscoveryTrigger;
}

interface FinishDetails {
  usage?: DiscoveryRunUsage;
  failureCategory?: DiscoveryFailureCategory;
  publicationDeadline?: Date;
}

interface StoreOptions {
  now?: () => Date;
  leaseMs?: number;
  budget?: NoteDiscoveryBudgetService;
}

const activeStatuses = ['queued', 'running'];
const pendingFields = ['pendingWatermark', 'pendingIdempotencyKey', 'pendingTrigger', 'pendingAvailableAt'];
const unsetPending = { $unset: Object.fromEntries(pendingFields.map((field) => [field, 1])) };
const latestFirst = { createdAt: -1, _id: -1 } as const;
const writeConcern = { w: 'majority', j: true } as const;

function compareWatermarks(a: StoredWatermark, b: StoredWatermark): number {
  const dateDifference = a.changedAt.getTime() - b.changedAt.getTime();
  if (dateDifference) return dateDifference;
  const aId = a.noteId?.toHexString() ?? '';
  const bId = b.noteId?.toHexString() ?? '';
  if (aId !== bId) return aId < bId ? -1 : 1;
  return (a.revision ?? 0) - (b.revision ?? 0);
}

function sameWatermark(prefix: string, watermark?: StoredWatermark) {
  if (!watermark) return { [`${prefix}.changedAt`]: null };
  return {
    [`${prefix}.changedAt`]: watermark.changedAt,
    [`${prefix}.noteId`]: watermark.noteId ?? null,
    [`${prefix}.revision`]: watermark.revision ?? null,
  };
}

function leaseGeneration(token: string): number {
  const match = /^(\d+):[\da-f-]{36}$/.exec(token);
  return match ? Number(match[1]) : -1;
}

function asClaimed(run: StoredDiscoveryRun | null): ClaimedDiscoveryRun | null {
  if (run?.status !== 'running' || !run.leaseToken || !run.leaseUntil || run.recoveringGeneration != null) return null;
  return { ...run, status: 'running', leaseToken: run.leaseToken, leaseUntil: run.leaseUntil };
}

function isDuplicate(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

export class NoteDiscoveryWorkerStore {
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly budget: NoteDiscoveryBudgetService;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 30_000;
    this.budget = options.budget ?? noteDiscoveryBudgetService;
  }

  async getRun(userId: string, runId: string): Promise<StoredDiscoveryRun | null> {
    return NoteDiscoveryRun.findOne({ _id: runId, userId }).lean();
  }

  async getActiveRun(userId: string): Promise<StoredDiscoveryRun | null> {
    return NoteDiscoveryRun.findOne({ userId, status: { $in: activeStatuses } }).lean();
  }

  async getLatestRun(userId: string, trigger?: DiscoveryTrigger): Promise<StoredDiscoveryRun | null> {
    return NoteDiscoveryRun.findOne({ userId, ...(trigger ? { trigger } : {}) }).sort(latestFirst).lean();
  }

  async hasEnabledPreference(userId: string): Promise<boolean> {
    return !await NoteDiscoveryPreference.exists({ userId, automaticEnabled: false });
  }

  async enqueue(
    userId: string, watermark: DiscoveryWatermark, idempotencyKey: string, options: EnqueueOptions = {},
  ): Promise<StoredDiscoveryRun | null> {
    if (!(watermark.changedAt instanceof Date) || !Number.isFinite(watermark.changedAt.getTime())
      || (watermark.noteId !== undefined && !Types.ObjectId.isValid(watermark.noteId))
      || (watermark.revision !== undefined && (!Number.isSafeInteger(watermark.revision) || watermark.revision < 1))) {
      throw new Error('Invalid discovery watermark');
    }
    const storedWatermark: StoredWatermark = {
      changedAt: watermark.changedAt, revision: watermark.revision,
      noteId: watermark.noteId ? new Types.ObjectId(watermark.noteId) : undefined,
    };
    const key = idempotencyKey.trim();
    if (!key || key.length > 200) throw new Error('Invalid discovery idempotency key');
    return this.enqueueStored(userId, storedWatermark, key, options.availableAt ?? this.now(), options.trigger ?? 'automatic');
  }

  async claimNext(now = this.now()): Promise<ClaimedDiscoveryRun | null> {
    for (;;) {
      const recovered = await this.takeExpiredLease(now);
      if (recovered) {
        const run = await this.completeRecovery(recovered);
        if (run && (run.trigger === 'manual' || await this.hasEnabledPreference(run.userId.toHexString()))) return run;
        if (run) await this.finish(run._id.toHexString(), run.leaseToken, 'cancelled');
        continue;
      }

      await this.drainPending();
      const run = asClaimed(await NoteDiscoveryRun.findOneAndUpdate({
        status: 'queued', availableAt: { $lte: now },
      }, this.leasePipeline(now, false), {
        sort: { availableAt: 1, _id: 1 }, returnDocument: 'after',
      }).lean());
      if (!run || run.trigger === 'manual' || await this.hasEnabledPreference(run.userId.toHexString())) return run;
      await this.finish(run._id.toHexString(), run.leaseToken, 'cancelled');
    }
  }

  async renewLease(runId: string, token: string): Promise<boolean> {
    const now = this.now();
    const result = await NoteDiscoveryRun.updateOne(this.leaseFilter(runId, token, now), {
      $max: { leaseUntil: new Date(now.getTime() + this.leaseMs) },
    });
    return result.matchedCount === 1;
  }

  async isCurrentFence(fence: DiscoveryRunFence): Promise<boolean> {
    return !!await NoteDiscoveryRun.exists({ ...this.fenceFilter(fence), executionCancelled: { $ne: true } });
  }

  async markProviderStarted(fence: DiscoveryRunFence, reservationId: string, deadline?: Date): Promise<boolean> {
    if (!await this.budget.isDispatchableReservation(fence, reservationId)) return false;
    const now = this.now();
    const result = await NoteDiscoveryRun.updateOne({
      ...this.fenceFilter(fence, now), providerReservationId: null,
      executionCancelled: { $ne: true }, providerDeliveryUnknown: { $ne: true }, sentReservationIds: { $ne: reservationId },
      ...(deadline ? { $expr: { $gt: [{ $literal: deadline }, '$$NOW'] } } : {}),
    }, [{
      $set: {
        providerReservationId: { $literal: reservationId },
        providerStartedAt: { $ifNull: ['$providerStartedAt', now] },
        sentReservationIds: { $concatArrays: [{ $ifNull: ['$sentReservationIds', []] }, { $literal: [reservationId] }] },
      },
    }], { writeConcern });
    if (!result.matchedCount) return false;
    if (await this.budget.isDispatchableReservation(fence, reservationId) && await this.isCurrentFence(fence)) return true;
    // The caller will receive false and cannot dispatch from this marker.
    await NoteDiscoveryRun.updateOne({
      ...this.fenceFilter(fence), providerReservationId: reservationId,
    }, { $set: { providerReservationId: null } });
    return false;
  }

  async markProviderFinished(fence: DiscoveryRunFence, reservationId: string): Promise<boolean> {
    const delivery = await this.budget.settledDelivery(fence, reservationId);
    if (!delivery) return false;
    const result = await NoteDiscoveryRun.updateOne({
      ...this.fenceFilter(fence), providerReservationId: reservationId,
    }, {
      $set: { providerReservationId: null, ...(delivery === 'delivery_unknown' ? { providerDeliveryUnknown: true } : {}) },
    }, { writeConcern });
    return result.matchedCount === 1;
  }

  async incrementRetry(fence: DiscoveryRunFence, deadline?: Date): Promise<boolean> {
    const result = await NoteDiscoveryRun.updateOne({
      ...this.fenceFilter(fence), retryCount: 0, providerReservationId: null,
      executionCancelled: { $ne: true }, providerDeliveryUnknown: { $ne: true },
      ...(deadline ? { $expr: { $gt: [{ $literal: deadline }, '$$NOW'] } } : {}),
    }, { $inc: { retryCount: 1 } });
    return result.matchedCount === 1;
  }

  async finish(runId: string, token: string, status: FinishStatus, details: FinishDetails = {}): Promise<boolean> {
    const now = this.now();
    // For publication, compare on the server as well as at dispatch: a delayed
    // Mongo mutation must not commit after its lease or wall-clock deadline.
    const publicationTime = details.publicationDeadline;
    const finished = await NoteDiscoveryRun.findOneAndUpdate({
      ...this.leaseFilter(runId, token, now), providerReservationId: null,
      ...(status === 'completed' || status === 'no_result' ? { executionCancelled: { $ne: true } } : {}),
      ...(publicationTime ? { $expr: { $and: [
        { $gt: ['$leaseUntil', '$$NOW'] }, { $gt: [{ $literal: publicationTime }, '$$NOW'] },
      ] } } : {}),
    }, {
      $set: {
        status, finishedAt: now, leaseToken: null, leaseUntil: null,
        usage: details.usage, failureCategory: details.failureCategory,
      },
    }, { projection: { userId: 1 }, runValidators: true, writeConcern }).lean();
    if (!finished) return false;
    // The pending watermark remains on this immutable run until it is safely acknowledged.
    // Promotion by future pollers recovers from a crash immediately after finishing.
    return true;
  }

  async cancelQueued(userId: string, trigger: DiscoveryTrigger | 'all' = 'automatic'): Promise<number> {
    const now = this.now();
    const pendingTrigger = trigger === 'automatic' ? { $in: ['automatic', null] } : trigger;
    await NoteDiscoveryRun.updateMany({
      userId, pendingWatermark: { $exists: true }, ...(trigger === 'all' ? {} : { pendingTrigger }),
    }, unsetPending);
    const result = await NoteDiscoveryRun.updateMany({
      userId, status: 'queued', ...(trigger === 'all' ? {} : { trigger }),
    }, {
      $set: { status: 'cancelled', finishedAt: now },
    });
    return result.modifiedCount;
  }

  /** Fence automatic execution in its own row without removing an in-flight attempt's settlement lease. */
  async cancelAutomaticRuns(userId: string): Promise<void> {
    const automatic = { $eq: ['$trigger', 'automatic'] };
    const queued = { $and: [automatic, { $eq: ['$status', 'queued'] }] };
    const running = { $and: [automatic, { $eq: ['$status', 'running'] }] };
    const manualPending = { $eq: ['$pendingTrigger', 'manual'] };
    await NoteDiscoveryRun.updateMany({
      userId, $or: [
        { trigger: 'automatic', status: { $in: activeStatuses } },
        { pendingWatermark: { $exists: true }, pendingTrigger: { $in: ['automatic', null] } },
      ],
    }, [{ $set: {
      status: { $cond: [queued, 'cancelled', '$status'] },
      finishedAt: { $cond: [queued, this.now(), '$finishedAt'] },
      executionCancelled: { $cond: [running, true, '$executionCancelled'] },
      ...Object.fromEntries(pendingFields.map(field => [field, { $cond: [manualPending, `$${field}`, '$$REMOVE'] }])),
    } }], { writeConcern });
  }

  /** Global shutdown suppresses every queued trigger and pending successor. */
  async cancelAllQueued(): Promise<number> {
    const result = await NoteDiscoveryRun.updateMany({
      $or: [{ status: 'queued' }, { pendingWatermark: { $exists: true } }],
    }, [{
      $set: {
        status: { $cond: [{ $eq: ['$status', 'queued'] }, 'cancelled', '$status'] },
        finishedAt: { $cond: [{ $eq: ['$status', 'queued'] }, this.now(), '$finishedAt'] },
        ...Object.fromEntries(pendingFields.map(field => [field, '$$REMOVE'])),
      },
    }], { writeConcern });
    return result.modifiedCount;
  }

  async drainPending(userId?: string): Promise<number> {
    const pending = await NoteDiscoveryRun.find({
      ...(userId ? { userId } : {}), status: { $nin: activeStatuses },
      pendingWatermark: { $exists: true }, pendingIdempotencyKey: { $exists: true },
    }).sort({ updatedAt: 1 }).limit(100).lean();
    let drained = 0;
    for (const predecessor of pending) {
      const { _id, pendingWatermark, pendingIdempotencyKey, pendingTrigger, pendingAvailableAt } = predecessor;
      if (!pendingWatermark || !pendingIdempotencyKey) continue;
      // enqueueStored either durably carries this watermark forward or confirms it was superseded.
      // A disabled automatic preference explicitly cancels the pending work.
      await this.enqueueStored(
        predecessor.userId.toHexString(), pendingWatermark, pendingIdempotencyKey,
        pendingAvailableAt ?? this.now(), pendingTrigger ?? 'automatic',
        _id,
      );
      const result = await NoteDiscoveryRun.updateOne({ _id, pendingIdempotencyKey }, unsetPending);
      drained += result.modifiedCount;
    }
    return drained;
  }

  private async enqueueStored(
    userId: string, watermark: StoredWatermark, key: string, availableAt: Date, trigger: DiscoveryTrigger,
    predecessorId?: Types.ObjectId,
  ): Promise<StoredDiscoveryRun | null> {
    await NoteDiscoveryRun.init();
    const publicKey = { userId, $or: [{ idempotencyKey: key }, { idempotencyAliases: key }] };
    for (;;) {
      const replay = predecessorId
        ? await NoteDiscoveryRun.findOne({ userId, promotedPendingRunIds: predecessorId }).lean()
        : await NoteDiscoveryRun.findOne({ userId, idempotencyAliases: key }).lean()
          ?? await NoteDiscoveryRun.findOne({ userId, idempotencyKey: key }).lean();
      if (replay) return replay;
      if (trigger === 'automatic' && !await this.hasEnabledPreference(userId)) return null;
      // A direct manual call is replayed against the run that first accepted it. Each
      // outbox hop also needs its own receipt, even if the public key was already accepted.
      const keepManualAlias = trigger === 'manual' && (!predecessorId || !await NoteDiscoveryRun.exists(publicKey));
      const addReceipt = {
        ...(keepManualAlias ? { idempotencyAliases: key } : {}),
        ...(predecessorId ? { promotedPendingRunIds: predecessorId } : {}),
      };

      const active = await this.getActiveRun(userId);
      if (active) {
        const pending = active.status === 'running';
        const currentWatermark = (pending && active.pendingWatermark) || active.watermark;
        const existingTrigger = pending ? active.pendingTrigger : active.trigger;
        const promotesToManual = trigger === 'manual' && existingTrigger !== 'manual';
        const isNewer = compareWatermarks(watermark, currentWatermark) > 0;
        const updateWatermark = active.pendingIdempotencyKey !== key && (isNewer || promotesToManual);
        if (!updateWatermark && !keepManualAlias && !predecessorId) return active;
        const nextWatermark = isNewer ? watermark : currentWatermark;
        const fields = pending ? {
          pendingWatermark: nextWatermark,
          pendingIdempotencyKey: existingTrigger === 'manual' ? active.pendingIdempotencyKey : key,
          pendingAvailableAt: existingTrigger === 'manual' ? active.pendingAvailableAt : availableAt,
          pendingTrigger: existingTrigger === 'manual' ? 'manual' : trigger,
        } : {
          watermark: nextWatermark,
          availableAt: active.trigger === 'manual' ? active.availableAt : availableAt,
          ...(promotesToManual ? { trigger } : {}),
        };
        try {
          const changed = await NoteDiscoveryRun.findOneAndUpdate({
            _id: active._id, userId, generation: active.generation, status: active.status,
            trigger: active.trigger, idempotencyKey: active.idempotencyKey,
            ...sameWatermark('watermark', active.watermark),
            ...sameWatermark('pendingWatermark', active.pendingWatermark),
            pendingIdempotencyKey: active.pendingIdempotencyKey ?? null,
          }, {
            ...(updateWatermark ? { $set: fields } : {}),
            ...(keepManualAlias || predecessorId ? { $addToSet: addReceipt } : {}),
          }, { returnDocument: 'after', runValidators: true, writeConcern }).lean();
          if (changed) return changed;
        } catch (error) {
          if (!isDuplicate(error)) throw error;
        }
        continue;
      }

      if (trigger === 'automatic') {
        const covered = await NoteDiscoveryRun.findOne({
          userId, status: { $in: ['completed', 'no_result'] },
          'watermark.changedAt': { $gte: watermark.changedAt },
        }).sort({ 'watermark.changedAt': -1, 'watermark.noteId': -1, 'watermark.revision': -1 }).lean();
        if (covered && compareWatermarks(covered.watermark, watermark) >= 0) {
          if (!predecessorId) return covered;
          try {
            await NoteDiscoveryRun.updateOne({ _id: covered._id, userId }, { $addToSet: addReceipt }, { writeConcern });
            return covered;
          } catch (error) {
            if (!isDuplicate(error)) throw error;
            continue;
          }
        }
      }

      try {
        const idempotencyKey = predecessorId && await NoteDiscoveryRun.exists({ userId, idempotencyKey: key })
          ? `pending:${randomUUID()}`
          : key;
        const [created] = await NoteDiscoveryRun.create([{
          userId, trigger, idempotencyKey, watermark, availableAt,
          ...(!predecessorId || keepManualAlias ? { idempotencyAliases: [key] } : {}),
          ...(predecessorId ? { promotedPendingRunIds: [predecessorId] } : {}),
        }], { writeConcern });
        return created.toObject();
      } catch (error) {
        if (!isDuplicate(error)) throw error;
      }
    }
  }

  private leaseFilter(runId: string, token: string, now: Date) {
    return {
      _id: runId, status: 'running', generation: leaseGeneration(token), leaseToken: token,
      leaseUntil: { $gt: now }, recoveringGeneration: null,
    };
  }

  private fenceFilter(fence: DiscoveryRunFence, now = this.now()) {
    // Both the explicit generation and the token's embedded generation must agree.
    const lease = this.leaseFilter(fence.runId, fence.leaseToken, now);
    return { ...lease, generation: lease.generation === fence.generation ? fence.generation : -1, userId: fence.userId };
  }

  private leasePipeline(now: Date, recovering: boolean) {
    const nextGeneration = { $add: ['$generation', 1] };
    return [{
      $set: {
        status: 'running',
        generation: nextGeneration,
        leaseToken: { $concat: [{ $toString: nextGeneration }, ':', randomUUID()] },
        leaseUntil: new Date(now.getTime() + this.leaseMs),
        ...(recovering ? { recoveringGeneration: { $ifNull: ['$recoveringGeneration', '$generation'] } } : { startedAt: now }),
      },
    }];
  }

  private async takeExpiredLease(now: Date): Promise<StoredDiscoveryRun | null> {
    return NoteDiscoveryRun.findOneAndUpdate({
      status: 'running', leaseUntil: { $lte: now },
    }, this.leasePipeline(now, true), {
      sort: { leaseUntil: 1, _id: 1 }, returnDocument: 'after',
    }).lean();
  }

  private async completeRecovery(run: StoredDiscoveryRun): Promise<ClaimedDiscoveryRun | null> {
    if (run.recoveringGeneration == null || !run.leaseToken) return null;
    await this.budget.settleExpiredGeneration({
      runId: run._id.toHexString(), userId: run.userId.toHexString(),
      leaseToken: run.leaseToken, generation: run.generation,
    }, run.recoveringGeneration);
    const now = this.now();
    const filter = { ...this.leaseFilter(run._id.toHexString(), run.leaseToken, now), recoveringGeneration: run.recoveringGeneration };
    const unknownDelivery = run.providerReservationId || run.providerDeliveryUnknown;
    const fields = run.executionCancelled && !unknownDelivery ? {
      status: 'cancelled', finishedAt: now, leaseToken: null, leaseUntil: null,
    } : run.providerStartedAt ? {
      status: 'failed', failureCategory: unknownDelivery ? 'usage_unknown' : 'expired_lease',
      finishedAt: now,
      leaseToken: null, leaseUntil: null, providerReservationId: null,
    } : { startedAt: now };
    return asClaimed(await NoteDiscoveryRun.findOneAndUpdate(filter, {
      $set: { recoveringGeneration: null, ...fields },
    }, { returnDocument: 'after' }).lean());
  }
}

export const noteDiscoveryWorkerStore = new NoteDiscoveryWorkerStore();

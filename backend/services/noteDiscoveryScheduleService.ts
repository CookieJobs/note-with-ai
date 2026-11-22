import { isDiscoveryUserCleaningUp } from '../models/NoteDiscoveryCleanup';
import { Types } from 'mongoose';
import { config } from '../config';
import { isNoteDiscoveryAccessGranted, noteDiscoveryAccountFilter } from './noteDiscoveryAccess';
import { Note } from '../models/Note';
import User from '../models/User';
import NoteDiscoveryPreference from '../models/NoteDiscoveryPreference';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import type { DiscoveryPreferenceRecord, DiscoveryScheduleState, DiscoveryTrigger, DiscoveryWatermark } from '../types/noteDiscovery';
import { DEFAULT_DISCOVERY_TIME_ZONE } from '../types/noteDiscovery';
import { noteDiscoveryWorkerStore, type NoteDiscoveryWorkerStore, type StoredDiscoveryRun, type ClaimedDiscoveryRun } from './noteDiscoveryWorkerStore';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const writeConcern = { w: 'majority', j: true } as const;
type Watermark = DiscoveryWatermark<Types.ObjectId>;
type Preference = DiscoveryPreferenceRecord & { _id: Types.ObjectId };
export interface DiscoveryAdmissionResult {
  status: 'queued' | 'running' | 'authorized' | 'limited' | 'disabled' | 'idle' | 'stale' | 'blocked';
  currentRun: StoredDiscoveryRun | null;
  retryAt?: Date;
}
interface ScheduleOptions {
  enabled?: boolean;
  now?: () => Date;
  store?: Pick<NoteDiscoveryWorkerStore, 'enqueue' | 'getActiveRun' | 'getLatestRun' | 'getRun' | 'cancelQueued' | 'cancelAutomaticRuns' | 'isCurrentFence'>;
  readLatest?: (userId: string) => Promise<DiscoveryWatermark | null>;
  debounceMs?: number;
  autoDailyLimit?: number;
  autoHourlyLimit?: number;
  manualDailyLimit?: number;
  manualCooldownMs?: number;
}

function validZone(zone: string): string {
  if (/^[+-]/.test(zone) || zone.length > 100) throw new Error('An IANA time zone is required');
  try { return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone; }
  catch { throw new Error('An IANA time zone is required'); }
}
export function discoveryLocalDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function nextLocalDay(now: Date, zone: string): number {
  const today = discoveryLocalDate(now, zone);
  let low = now.getTime(), high = low + 2 * DAY;
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2);
    if (discoveryLocalDate(new Date(middle), zone) === today) low = middle;
    else high = middle;
  }
  return high;
}
function compare(a?: Watermark, b?: Watermark): number {
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  return a.changedAt.getTime() - b.changedAt.getTime()
    || String(a.noteId ?? '').localeCompare(String(b.noteId ?? ''))
    || (a.revision ?? 0) - (b.revision ?? 0);
}
function stored(watermark: DiscoveryWatermark): Watermark {
  return { ...watermark, noteId: watermark.noteId ? new Types.ObjectId(watermark.noteId) : undefined };
}
function publicWatermark(watermark: Watermark): DiscoveryWatermark {
  return { ...watermark, noteId: watermark.noteId?.toHexString() };
}
function bounded(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid discovery scheduling limit');
  return value;
}
const initialState = (): DiscoveryScheduleState => ({ version: 0, initialized: false, epoch: 0, admissions: [] });

// All pending fields are removed in the same fenced update as absorption/cancellation.
// Manual requests and boundaries beyond this run remain a separate durable obligation.
function clearAbsorbedAutomaticPending(watermark: Watermark) {
  const pendingDate = '$pendingWatermark.changedAt';
  const pendingId = { $ifNull: ['$pendingWatermark.noteId', null] };
  const targetDate = { $literal: watermark.changedAt };
  const targetId = { $literal: watermark.noteId ?? null };
  const dateEqual = { $eq: [pendingDate, targetDate] };
  const idEqual = { $eq: [pendingId, targetId] };
  const absorbed = { $and: [
    { $ne: [{ $type: '$pendingWatermark' }, 'missing'] },
    { $ne: [{ $ifNull: ['$pendingTrigger', 'automatic'] }, 'manual'] },
    { $or: [
      { $lt: [pendingDate, targetDate] },
      { $and: [dateEqual, { $lt: [pendingId, targetId] }] },
      { $and: [dateEqual, idEqual, { $lte: [{ $ifNull: ['$pendingWatermark.revision', 0] }, watermark.revision ?? 0] }] },
    ] },
  ] };
  return Object.fromEntries(['pendingWatermark', 'pendingIdempotencyKey', 'pendingAvailableAt', 'pendingTrigger']
    .map((field) => [field, { $cond: [absorbed, '$$REMOVE', `$${field}`] }]));
}

/** Durable outbox + admission. Worker must call authorizeRun before any paid work and canPublish before publication. */
export class NoteDiscoveryScheduleService {
  private readonly enabled: boolean;
  private readonly now: () => Date;
  private readonly store: NonNullable<ScheduleOptions['store']>;
  private readonly readLatest: NonNullable<ScheduleOptions['readLatest']>;
  private readonly debounce: number;
  private readonly autoDaily: number;
  private readonly autoHourly: number;
  private readonly manualDaily: number;
  private readonly manualCooldown: number;
  constructor(options: ScheduleOptions = {}) {
    this.enabled = options.enabled ?? config.NOTE_DISCOVERY_RUNNABLE;
    this.now = options.now ?? (() => new Date());
    this.store = options.store ?? noteDiscoveryWorkerStore;
    this.readLatest = options.readLatest ?? (async (userId) => {
      const note = await Note.findOne({ userId }).sort({ updatedAt: -1, _id: -1 }).select('_id updatedAt revision').lean();
      return note ? { changedAt: note.updatedAt, noteId: note._id.toHexString(), revision: note.revision } : null;
    });
    this.debounce = bounded(options.debounceMs ?? config.NOTE_DISCOVERY_AUTO_DEBOUNCE_MS, DAY);
    this.autoDaily = bounded(options.autoDailyLimit ?? config.NOTE_DISCOVERY_AUTO_DAILY_LIMIT, 1000);
    this.autoHourly = bounded(options.autoHourlyLimit ?? config.NOTE_DISCOVERY_AUTO_HOURLY_LIMIT, 1000);
    this.manualDaily = bounded(options.manualDailyLimit ?? config.NOTE_DISCOVERY_MANUAL_DAILY_LIMIT, 1000);
    this.manualCooldown = bounded(options.manualCooldownMs ?? config.NOTE_DISCOVERY_MANUAL_COOLDOWN_MS, DAY);
  }

  async scheduleChanged(userId: string, noteId: string, revision: number, now = this.now()): Promise<void> {
    if (!this.enabled || !await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) return;
    if (!Types.ObjectId.isValid(noteId) || !Number.isSafeInteger(revision) || revision < 1 || !Number.isFinite(now.getTime())) {
      throw new Error('Invalid discovery change');
    }
    await this.mutate(userId, (preference, state) => {
      const previous = state.changedWatermark;
      if (String(previous?.noteId) === noteId && (previous?.revision ?? 0) >= revision) return;
      state.initialized = true;
      state.changedWatermark = { changedAt: new Date(Math.max(now.getTime(), (previous?.changedAt.getTime() ?? -1) + 1)), noteId: new Types.ObjectId(noteId), revision };
      state.dueAt = new Date(Math.max(state.dueAt?.getTime() ?? 0, now.getTime() + this.debounce));
    });
    await this.reconcile(userId, now);
  }

  async initializeOnVisit(userId: string, timeZone?: string, now = this.now()): Promise<DiscoveryAdmissionResult> {
    if (!this.enabled || !await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) return this.result('disabled');
    const zone = timeZone === undefined ? undefined : validZone(timeZone);
    const latest = await this.readLatest(userId);
    const preference = await this.mutate(userId, (pref, state) => {
      if (zone) pref.timeZone = zone;
      if (!state.initialized) {
        state.initialized = true;
        if (latest) state.changedWatermark = stored(latest);
        state.dueAt = now;
      } else if ((!state.lastSuccessfulAt || now.getTime() - state.lastSuccessfulAt.getTime() > DAY)
        && latest && compare(stored(latest), state.lastSuccessfulWatermark) > 0) {
        if (compare(stored(latest), state.changedWatermark) > 0) state.changedWatermark = stored(latest);
        state.dueAt ??= now;
      }
    });
    if (preference.schedule?.lastSuccessfulAt && now.getTime() - preference.schedule.lastSuccessfulAt.getTime() <= DAY) {
      return this.result('idle', await this.store.getActiveRun(userId));
    }
    return this.reconcile(userId, now);
  }

  async setAutomaticEnabled(userId: string, enabled: boolean, now = this.now()): Promise<DiscoveryAdmissionResult> {
    if (!await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) return this.result('disabled');
    // Preferences remain editable while the global feature is off.
    const latest = enabled && this.enabled ? await this.readLatest(userId) : null;
    await this.mutate(userId, (pref, state) => {
      const reenabled = enabled && !pref.automaticEnabled;
      pref.automaticEnabled = enabled;
      if (reenabled) {
        state.epoch += 1;
        state.initialized = true;
        if (latest && compare(stored(latest), state.changedWatermark) > 0) state.changedWatermark = stored(latest);
        state.dueAt = new Date(Math.max(state.dueAt?.getTime() ?? 0, now.getTime()));
      }
    });
    if (!enabled) {
      await this.store.cancelAutomaticRuns(userId);
      return this.result('disabled', await this.store.getActiveRun(userId));
    }
    return this.reconcile(userId, now);
  }

  async requestManual(userId: string, key: string, now = this.now()): Promise<DiscoveryAdmissionResult> {
    if (!this.enabled || !await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) return this.result('disabled');
    if (!key.trim() || key.length > 150) throw new Error('Invalid manual idempotency key');
    // Replay precedes quota checks, including terminal requests.
    const replay = await NoteDiscoveryRun.findOne({ userId, $or: [{ idempotencyKey: `manual:${key}` }, { idempotencyAliases: `manual:${key}` }] }).lean();
    if (replay) return this.result(replay.status === 'running' ? 'running' : 'queued', replay);
    const pref = await this.mutate(userId, () => {});
    const active = await this.store.getActiveRun(userId);
    const retryAt = this.eligibility(pref, 'manual', now);
    // Coalescing an existing manual queued/pending request never consumes another quota.
    if (retryAt && active?.trigger !== 'manual' && active?.pendingTrigger !== 'manual') return this.result('limited', active, retryAt);
    const latest = await this.readLatest(userId);
    const watermark = latest ?? { changedAt: now };
    if (!await isNoteDiscoveryAccessGranted(userId)) return this.result('disabled');
    if (active?.status === 'running' && active.trigger === 'manual' && compare(stored(watermark), active.watermark) <= 0) {
      try {
        const coalesced = await NoteDiscoveryRun.findOneAndUpdate({ _id: active._id, userId, status: 'running', generation: active.generation }, {
          $addToSet: { idempotencyAliases: `manual:${key}` },
        }, { returnDocument: 'after', writeConcern }).lean();
        if (coalesced) return this.result('running', coalesced);
      } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
      return this.requestManual(userId, key, now);
    }
    const run = await this.store.enqueue(userId, watermark, `manual:${key}`, { availableAt: now, trigger: 'manual' });
    return this.result(run?.status === 'running' ? 'running' : 'queued', run);
  }

  async reconcile(userId: string, now = this.now(), force = false): Promise<DiscoveryAdmissionResult> {
    if (!this.enabled || !await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) return this.result('disabled');
    const success = await NoteDiscoveryRun.findOne({ userId, status: { $in: ['completed', 'no_result'] } })
      .sort({ 'watermark.changedAt': -1, 'watermark.noteId': -1, 'watermark.revision': -1, finishedAt: -1, _id: -1 }).lean();
    // Search the durable account history, not only the most recent attempt. A later
    // ordinary/manual failure cannot erase an uncertain paid attempt's saved-state barrier.
    const unknown = await this.getUnknownBarrier(userId);
    const pref = await this.mutate(userId, (_pref, state) => {
      if (success && (compare(success.watermark, state.lastSuccessfulWatermark) > 0
        || (compare(success.watermark, state.lastSuccessfulWatermark) === 0
          && (success.finishedAt?.getTime() ?? 0) > (state.lastSuccessfulAt?.getTime() ?? 0)))) {
        state.lastSuccessfulWatermark = success.watermark;
        state.lastSuccessfulAt = success.finishedAt ?? now;
      }
      if ((!force && compare(state.changedWatermark, state.lastSuccessfulWatermark) <= 0)
        || (unknown && compare(state.changedWatermark, unknown.watermark) <= 0)) delete state.dueAt;
    });
    const state = pref.schedule!;
    if (!pref.automaticEnabled) return this.result('disabled', await this.store.getActiveRun(userId));
    if (!state.changedWatermark || (!force && compare(state.changedWatermark, state.lastSuccessfulWatermark) <= 0)) return this.result('idle', await this.store.getActiveRun(userId));
    const latest = await this.store.getLatestRun(userId);
    const failed = latest && ['failed', 'cancelled', 'budget_blocked'].includes(latest.status) ? latest : null;
    // An uncertain delivery may already have consumed a paid call. Only a distinct new
    // saved change or explicit manual action may start another run for this account.
    if (unknown && compare(state.changedWatermark, unknown.watermark) <= 0) return this.result('idle', unknown);
    const quotaAt = this.eligibility(pref, 'automatic', now);
    const availableAt = new Date(Math.max(state.dueAt?.getTime() ?? now.getTime(), quotaAt?.getTime() ?? 0,
      failed ? (failed.finishedAt?.getTime() ?? now.getTime()) + this.debounce : 0));
    await this.mutate(userId, (_pref, current) => {
      // Never clear or postpone a concurrently saved newer change using an old snapshot.
      if (compare(current.changedWatermark, state.changedWatermark) === 0) current.dueAt = availableAt;
    });
    const key = `auto:${state.epoch}:${state.changedWatermark.changedAt.getTime()}:${state.changedWatermark.noteId ?? ''}:${state.changedWatermark.revision ?? 0}:${failed?._id ?? ''}`;
    if (!await isNoteDiscoveryAccessGranted(userId)) return this.result('disabled');
    const run = await this.store.enqueue(userId, publicWatermark(state.changedWatermark), key, { availableAt, trigger: 'automatic' });
    // Close off-vs-enqueue race. Manual promotion remains protected by store's trigger filter.
    if (await NoteDiscoveryPreference.exists({ userId, automaticEnabled: false })) await this.store.cancelQueued(userId);
    return this.result(quotaAt ? 'limited' : run?.status === 'running' ? 'running' : 'queued', run, quotaAt);
  }

  /** Invoke once on independent worker startup, including after enabling the global feature. */
  async initializeOnStartup(now = this.now()): Promise<number> {
    if (!this.enabled) return 0;
    let count = 0;
    const users = User.find(noteDiscoveryAccountFilter()).sort({ _id: 1 }).select('_id').lean().cursor({ batchSize: 100 });
    for await (const user of users) {
      const userId = String(user._id);
      if (!await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) continue;
      const latest = await this.readLatest(userId);
      await this.mutate(userId, (_pref, state) => {
        state.initialized = true;
        // Startup also repairs changes missed while the global feature was disabled.
        if (latest && compare(stored(latest), state.changedWatermark) > 0) {
          state.changedWatermark = stored(latest);
          state.dueAt = now;
        }
      });
      await this.reconcile(userId, now);
      count += 1;
    }
    return count;
  }

  async scanDue(now = this.now()): Promise<number> {
    if (!this.enabled) return 0;
    let count = 0;
    let after: Types.ObjectId | undefined;
    for (;;) {
      const users = await NoteDiscoveryPreference.aggregate<{ userId: Types.ObjectId }>([
        { $match: { automaticEnabled: true,
          'schedule.changedWatermark': { $exists: true }, 'schedule.dueAt': { $lte: now },
          ...(after ? { userId: { $gt: after } } : {}),
        } },
        { $sort: { userId: 1 } },
        { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'owner' } },
        { $unwind: '$owner' },
        { $match: noteDiscoveryAccountFilter('owner.') },
        { $limit: 100 },
        { $project: { userId: 1 } },
      ]);
      for (const user of users) await this.reconcile(user.userId.toHexString(), now);
      count += users.length;
      if (users.length < 100) return count;
      after = users[users.length - 1].userId;
    }
  }

  async authorizeRun(run: ClaimedDiscoveryRun, now = this.now()): Promise<DiscoveryAdmissionResult> {
    if (!this.enabled || run.executionCancelled) return this.result('disabled', run);
    const userId = run.userId.toHexString();
    if (!await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) return this.result('disabled', run);
    const fence = { runId: run._id.toHexString(), userId, generation: run.generation, leaseToken: run.leaseToken };
    // Store promotion and crash recovery can reach admission without reconcile.
    // Enforce the durable paid-state barrier at this independent execution boundary.
    const unknown = run.trigger === 'automatic' ? await this.getUnknownBarrier(userId) : null;
    if (unknown && compare(run.watermark, unknown.watermark) <= 0) {
      const clock = this.now();
      const cancelled = await NoteDiscoveryRun.findOneAndUpdate({
        _id: run._id, userId, status: 'running', generation: run.generation, leaseToken: run.leaseToken,
        leaseUntil: { $gt: clock }, recoveringGeneration: null, providerReservationId: null, providerStartedAt: null,
      }, [{ $set: {
        status: 'cancelled', finishedAt: clock, leaseToken: null, leaseUntil: null,
        ...clearAbsorbedAutomaticPending(run.watermark),
      } }], { returnDocument: 'after', writeConcern }).lean();
      if (!cancelled) return this.result('stale', run);
      await this.mutate(userId, (_pref, state) => {
        if (compare(state.changedWatermark, unknown.watermark) <= 0) delete state.dueAt;
      });
      return this.result('blocked', cancelled);
    }
    // Read before CAS; all instances serialize admission on the same preference version.
    let outcome: DiscoveryAdmissionResult = this.result('stale', run);
    let deferredWatermark: Watermark | undefined;
    await this.mutate(userId, (pref, state) => {
      if (run.trigger === 'automatic' && !pref.automaticEnabled) { outcome = this.result('disabled', run); return; }
      if (state.admissions.some((receipt) => receipt.runId === fence.runId)) { outcome = this.result('authorized', run); return; }
      const quotaAt = this.eligibility(pref, run.trigger, now);
      const silenceAt = run.trigger === 'automatic' && state.dueAt && state.dueAt.getTime() > now.getTime() ? state.dueAt : undefined;
      const retryAt = quotaAt || silenceAt ? new Date(Math.max(quotaAt?.getTime() ?? 0, silenceAt?.getTime() ?? 0)) : undefined;
      deferredWatermark = state.changedWatermark;
      if (retryAt) {
        if (run.trigger === 'automatic') state.dueAt = retryAt;
        outcome = this.result('limited', run, retryAt); return;
      }
      state.admissions = state.admissions.filter((receipt) => receipt.at.getTime() > now.getTime() - 2 * DAY);
      state.admissions.push({ runId: fence.runId, trigger: run.trigger, at: now });
      if (run.trigger === 'automatic') state.dueAt = new Date(now.getTime() + config.NOTE_DISCOVERY_TIMEOUT_MS);
      outcome = this.result('authorized', run);
    }, async () => {
      const current = await this.store.getRun(userId, fence.runId);
      if (current?.executionCancelled && current.leaseToken === fence.leaseToken) {
        outcome = this.result('disabled', current);
        return false;
      }
      if (!await isNoteDiscoveryAccessGranted(userId)) {
        outcome = this.result('disabled', current);
        return false;
      }
      return !!current && current.status === 'running' && await this.store.isCurrentFence(fence);
    });
    if (outcome.status === 'limited') {
      const absorbed = run.trigger === 'automatic' && compare(deferredWatermark, run.watermark) > 0 ? deferredWatermark! : run.watermark;
      const deferred = await NoteDiscoveryRun.updateOne({ _id: run._id, userId, status: 'running', generation: run.generation, leaseToken: run.leaseToken,
        leaseUntil: { $gt: this.now() }, recoveringGeneration: null, executionCancelled: { $ne: true },
        providerReservationId: null, providerStartedAt: null }, [{
        $set: { status: 'queued', availableAt: outcome.retryAt, leaseToken: null, leaseUntil: null,
          ...(run.trigger === 'automatic' ? { watermark: { $literal: absorbed }, ...clearAbsorbedAutomaticPending(absorbed) } : {}),
        },
      }], { writeConcern });
      if (!deferred.matchedCount) return this.result('stale', run);
    } else if (outcome.status === 'authorized' && !await this.canPublish(run)) return this.result('disabled', run);
    return outcome;
  }

  async canPublish(run: ClaimedDiscoveryRun): Promise<boolean> {
    if (!this.enabled) return false;
    const userId = run.userId.toHexString();
    if (!await isNoteDiscoveryAccessGranted(userId) || await isDiscoveryUserCleaningUp(userId)) return false;
    if (run.trigger === 'automatic' && !await NoteDiscoveryPreference.exists({ userId, automaticEnabled: true })) return false;
    return this.store.isCurrentFence({ runId: run._id.toHexString(), userId, generation: run.generation, leaseToken: run.leaseToken });
  }

  private async getUnknownBarrier(userId: string): Promise<StoredDiscoveryRun | null> {
    return NoteDiscoveryRun.findOne({ userId, status: 'failed',
      $or: [{ providerDeliveryUnknown: true }, { failureCategory: 'usage_unknown' }],
    }).sort({ 'watermark.changedAt': -1, 'watermark.noteId': -1, 'watermark.revision': -1 }).lean();
  }

  private eligibility(pref: Preference, trigger: DiscoveryTrigger, now: Date): Date | undefined {
    const receipts = (pref.schedule?.admissions ?? []).filter((receipt) => receipt.trigger === trigger);
    const timestamp = now.getTime();
    const day = discoveryLocalDate(now, pref.timeZone);
    const dailyLimit = trigger === 'automatic' ? this.autoDaily : this.manualDaily;
    let deadline = timestamp;
    const today = receipts.filter((r) => discoveryLocalDate(r.at, pref.timeZone) === day);
    if (today.length >= dailyLimit) deadline = Math.max(deadline, nextLocalDay(now, pref.timeZone));
    const rolling = receipts.filter((r) => r.at.getTime() > timestamp - DAY).sort((a, b) => a.at.getTime() - b.at.getTime());
    if (rolling.length >= dailyLimit) deadline = Math.max(deadline, rolling[rolling.length - dailyLimit].at.getTime() + DAY);
    if (trigger === 'automatic') {
      const hourly = receipts.filter((r) => r.at.getTime() > timestamp - HOUR).sort((a, b) => a.at.getTime() - b.at.getTime());
      if (hourly.length >= this.autoHourly) deadline = Math.max(deadline, hourly[hourly.length - this.autoHourly].at.getTime() + HOUR);
    } else if (receipts.length) deadline = Math.max(deadline, ...receipts.map((r) => r.at.getTime() + this.manualCooldown));
    return deadline > timestamp ? new Date(deadline) : undefined;
  }

  private result(status: DiscoveryAdmissionResult['status'], currentRun: StoredDiscoveryRun | null = null, retryAt?: Date): DiscoveryAdmissionResult {
    return { status, currentRun, ...(retryAt ? { retryAt } : {}) };
  }

  private async mutate(userId: string, change: (pref: Preference, state: DiscoveryScheduleState) => void, guard?: () => Promise<boolean>): Promise<Preference> {
    await NoteDiscoveryPreference.init();
    for (;;) {
      if (await isDiscoveryUserCleaningUp(userId)) {
        await NoteDiscoveryPreference.deleteMany({ userId });
        throw new Error('Discovery user cleanup in progress');
      }
      let pref = await NoteDiscoveryPreference.findOne({ userId }).lean();
      if (!pref) {
        try {
          await NoteDiscoveryPreference.create([{ userId, timeZone: DEFAULT_DISCOVERY_TIME_ZONE, automaticEnabled: false, schedule: initialState() }], { writeConcern });
        } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
        continue;
      }
      const state = pref.schedule ?? initialState();
      const version = state.version;
      if (guard && !await guard()) return pref;
      const before = JSON.stringify({ schedule: pref.schedule, automaticEnabled: pref.automaticEnabled, timeZone: pref.timeZone });
      change(pref, state);
      if (before === JSON.stringify({ schedule: state, automaticEnabled: pref.automaticEnabled, timeZone: pref.timeZone })) return pref;
      state.version = version + 1;
      const updated = await NoteDiscoveryPreference.findOneAndUpdate({ _id: pref._id, 'schedule.version': pref.schedule ? version : null }, {
        $set: { schedule: state, automaticEnabled: pref.automaticEnabled, timeZone: pref.timeZone },
      }, { returnDocument: 'after', runValidators: true, writeConcern }).lean();
      if (updated) {
        if (await isDiscoveryUserCleaningUp(userId)) {
          await NoteDiscoveryPreference.deleteMany({ userId });
          throw new Error('Discovery user cleanup in progress');
        }
        return updated;
      }
    }
  }
}
export const noteDiscoveryScheduleService = new NoteDiscoveryScheduleService();

import { isNoteDiscoveryAccessGranted } from './noteDiscoveryAccess';
import { isDiscoveryUserCleaningUp } from '../models/NoteDiscoveryCleanup';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { config } from '../config';
import NoteDiscoveryBudget, {
  PROVIDER_DELIVERY_DISPOSITIONS, type BudgetReservation, type ProviderDeliveryDisposition,
} from '../models/NoteDiscoveryBudget';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import Chat from '../models/Chat';
import { NoteDiscoveryChatTurn } from '../models/NoteDiscoveryChatTurn';
import type { DiscoveryRunFence } from '../types/noteDiscovery';
import logger from '../utils/logger';

export type { BudgetReservation, ProviderDeliveryDisposition } from '../models/NoteDiscoveryBudget';

type Rate = string | number;

export interface CostEstimate {
  provider: string;
  model: string;
  inputCnyPerMillion: Rate | undefined;
  outputCnyPerMillion: Rate | undefined;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export type UsageResult =
  | { kind: 'known'; inputTokens: number; outputTokens: number; costCnyMicros: number }
  | { kind: 'unknown'; reason: string };

interface BudgetSettings {
  enabled: boolean;
  userCapMicros: number | undefined;
  globalCapMicros: number | undefined;
  attemptCapMicros: number | undefined;
}

interface ReserveOptions {
  signal: AbortSignal;
  deadline: Date;
}

const MAX_RESERVATIONS = 10_000;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
// Settlement adds a timestamp, amount and short outcome to each reservation.
const SETTLEMENT_BYTES_PER_RESERVATION = 128;
const PRICE_SCALE = 10n ** 12n;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const writeConcern = { w: 'majority', j: true } as const;

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function rateUnits(rate: Rate | undefined): bigint | null {
  if (typeof rate !== 'number' && typeof rate !== 'string') return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e(-\d+))?$/.exec(String(rate));
  if (!match) return null;
  const [, whole, fraction = '', exponent = '0'] = match;
  const shift = 12 - fraction.length + Number(exponent);
  if (whole.length > 16 || shift < 0 || (typeof rate === 'string' && exponent !== '0')) return null;
  return BigInt(whole + fraction) * 10n ** BigInt(shift);
}

/** CNY per million tokens is numerically equivalent to micros per token. */
export function discoveryCostMicros(
  inputCnyPerMillion: Rate | undefined,
  outputCnyPerMillion: Rate | undefined,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!nonnegativeInteger(inputTokens) || !nonnegativeInteger(outputTokens)) return null;
  const input = rateUnits(inputCnyPerMillion);
  const output = rateUnits(outputCnyPerMillion);
  if (input === null || output === null) return null;
  const cost = (input * BigInt(inputTokens) + output * BigInt(outputTokens) + PRICE_SCALE - 1n) / PRICE_SCALE;
  return cost <= BigInt(MAX_SAFE) ? Number(cost) : null;
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && value.trim().length > 0;
}

function reservationDay(id: string): string | undefined {
  return /^(\d{4}-\d{2}-\d{2}):[\da-f-]{36}$/.exec(id)?.[1];
}

function isDuplicate(error: unknown) {
  return (error as { code?: number } | null)?.code === 11000;
}

export class DiscoveryBudgetOverrunError extends Error {
  constructor() {
    super('Discovery budget was blocked because an attempt exceeded its reservation');
    this.name = 'DiscoveryBudgetOverrunError';
  }
}

export class DiscoveryReservationRecoveryError extends Error {
  constructor() { super('discovery_reservation_requires_lease_recovery'); }
}

export class NoteDiscoveryBudgetService {
  constructor(
    private readonly settings: BudgetSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(runId: string, userId: string, generation: number, estimate: CostEstimate, options?: ReserveOptions, operationKind: 'discovery' | 'conversation' = 'discovery'): Promise<BudgetReservation | null> {
    if (options?.signal.aborted) return null;
    const { enabled, userCapMicros, globalCapMicros, attemptCapMicros } = this.settings;
    if (!enabled || !nonnegativeInteger(userCapMicros) || userCapMicros === 0
      || !nonnegativeInteger(globalCapMicros) || globalCapMicros === 0
      || !nonnegativeInteger(attemptCapMicros) || attemptCapMicros === 0
      || !Types.ObjectId.isValid(runId) || !Types.ObjectId.isValid(userId) || !nonnegativeInteger(generation)
      || !estimate || !validIdentity(estimate.provider) || !validIdentity(estimate.model)) return null;

    const amount = discoveryCostMicros(
      estimate.inputCnyPerMillion, estimate.outputCnyPerMillion, estimate.maxInputTokens, estimate.maxOutputTokens,
    );
    if (amount === null || amount > Math.min(userCapMicros, globalCapMicros, attemptCapMicros)) return null;
    if (await isDiscoveryUserCleaningUp(userId)) return null;
    const createdAt = this.now();
    const owner = new Types.ObjectId(userId);
    const operationModel: typeof NoteDiscoveryChatTurn = operationKind === 'conversation' ? NoteDiscoveryChatTurn : NoteDiscoveryRun;
    const run: any = await operationModel.findOne({
      _id: runId, userId: owner, generation, status: 'running', leaseUntil: { $gt: createdAt },
      recoveringGeneration: null, executionCancelled: { $ne: true },
      providerDeliveryUnknown: { $ne: true }, providerReservationId: null,
    }, { leaseUntil: 1, leaseToken: 1 }).lean();
    if (!run?.leaseToken || !run.leaseUntil || await this.blocked()) return null;

    const day = createdAt.toISOString().slice(0, 10);
    const reservation: BudgetReservation = {
      operationKind, id: `${day}:${randomUUID()}`, day, runId: run._id, userId: owner, generation,
      leaseToken: run.leaseToken, leaseUntil: run.leaseUntil, provider: estimate.provider, model: estimate.model,
      maxInputTokens: estimate.maxInputTokens, maxOutputTokens: estimate.maxOutputTokens,
      reservedMicros: amount, state: 'reserved', createdAt,
    };
    await this.ensureLedger(day);
    if (options?.signal.aborted) return null;
    const count = { $size: '$reservations' };
    const userKey = `users.${owner.toHexString()}`;
    const userSpent = { $ifNull: [`$${userKey}.spentMicros`, 0] };
    const userReserved = { $ifNull: [`$${userKey}.reservedMicros`, 0] };
    const addedReservations = { $concatArrays: ['$reservations', { $literal: [reservation] }] };
    const addedUsers = { $mergeObjects: ['$users', {
      [owner.toHexString()]: { spentMicros: userSpent, reservedMicros: { $add: [userReserved, amount] } },
    }] };
    const roomForReservation = { $lte: [
      { $add: [
        { $bsonSize: { $mergeObjects: ['$$ROOT', { users: addedUsers, reservations: addedReservations }] } },
        { $multiply: [{ $add: [count, 1] }, SETTLEMENT_BYTES_PER_RESERVATION] },
      ] },
      MAX_LEDGER_BYTES,
    ] };
    const insertionDeadline = options ? new Date(Math.min(options.deadline.getTime(), run.leaseUntil.getTime())) : undefined;
    const added = await NoteDiscoveryBudget.findOneAndUpdate({
      _id: day, blockedAt: { $exists: false },
      $expr: { $and: [
        { $lte: [{ $add: ['$spentTotalMicros', '$reservedTotalMicros'] }, globalCapMicros - amount] },
        { $lte: [{ $add: [userSpent, userReserved] }, userCapMicros - amount] },
        { $lt: [count, MAX_RESERVATIONS] },
        roomForReservation,
        // Do not insert behind the recovery scan if a timed-out worker goes away.
        ...(insertionDeadline ? [{ $gt: [{ $literal: insertionDeadline }, '$$NOW'] }] : []),
      ] },
    }, [{
      $set: {
        reservedTotalMicros: { $add: ['$reservedTotalMicros', amount] },
        users: addedUsers,
        reservations: addedReservations,
      },
    }], { projection: { _id: 1 }, writeConcern }).lean().catch(() => {
      // The update may have reached Mongo even when its acknowledgement did not.
      throw new DiscoveryReservationRecoveryError();
    });
    if (!added) {
      const [limited] = await NoteDiscoveryBudget.aggregate<{ _id: string }>([
        { $match: { _id: day, $expr: { $or: [{ $gte: [count, MAX_RESERVATIONS] }, { $not: [roomForReservation] }] } } },
        { $project: { _id: 1 } },
      ]);
      if (limited) logger.warn(`Discovery budget ledger capacity reached for ${day}`);
      return null;
    }

    // The run fence is in another document. A claim may expire while the ledger CAS is in flight.
    // The caller has not received this reservation and cannot have sent a request for it.
    const stillCurrent = !options?.signal.aborted && await operationModel.exists({
      _id: run._id, userId: owner, generation, status: 'running', leaseToken: run.leaseToken,
      leaseUntil: { $gt: this.now() }, recoveringGeneration: null,
      executionCancelled: { $ne: true }, providerDeliveryUnknown: { $ne: true }, providerReservationId: null,
    }).catch(() => { throw new DiscoveryReservationRecoveryError(); });
    if (!stillCurrent || await this.blocked().catch(() => { throw new DiscoveryReservationRecoveryError(); })) {
      await this.applySettlement(reservation, { kind: 'known', inputTokens: 0, outputTokens: 0, costCnyMicros: 0 }, 'not_sent')
        .catch(() => { throw new DiscoveryReservationRecoveryError(); });
      return null;
    }
    return reservation;
  }

  /** Conversation turns share monetary caps, without scheduler run-count admission. */
  async reserveConversation(turnId: string, userId: string, estimate: CostEstimate, options: ReserveOptions) {
    return this.reserve(turnId, userId, 1, estimate, options, 'conversation');
  }

  /** An irreversible cleanup tombstone makes an expired operation safe to settle without a live lease. */
  async recoverCleanupOperation(kind: 'discovery' | 'conversation', id: string): Promise<void> {
    const model: typeof NoteDiscoveryChatTurn = kind === 'conversation' ? NoteDiscoveryChatTurn : NoteDiscoveryRun;
    const operation: any = await model.findOne({ _id: id, cleanupRequested: true, $or: [
      { status: { $ne: 'running' } }, { leaseUntil: { $lte: this.now() } },
    ] }).lean();
    if (!operation) return;
    const ledgers = await NoteDiscoveryBudget.find({ reservations: { $elemMatch: { runId: operation._id, state: 'reserved' } } }).lean();
    for (const ledger of ledgers) for (const reservation of ledger.reservations) {
      if (reservation.runId.equals(operation._id) && reservation.state === 'reserved'
        && (reservation.operationKind ?? 'discovery') === kind) {
        await this.applySettlement(reservation, { kind: 'unknown', reason: 'account cleanup' }, 'delivery_unknown');
      }
    }
    await model.deleteOne({ _id: operation._id, cleanupRequested: true });
  }

  /** Called by the independent worker; expired attempts are never retried. */
  async recoverConversation(turnId: string): Promise<void> {
    const turn: any = await NoteDiscoveryChatTurn.findOne({ _id: turnId, status: 'running', leaseUntil: { $lte: this.now() } }).lean();
    if (!turn) return;
    if (turn.cleanupRequested) return this.recoverCleanupOperation('conversation', turnId);
    const ledgers = await NoteDiscoveryBudget.find({ reservations: { $elemMatch: {
      operationKind: 'conversation', runId: turn._id, state: 'reserved',
    } } }).lean();
    for (const ledger of ledgers) for (const reservation of ledger.reservations) {
      if (reservation.operationKind === 'conversation' && reservation.runId.equals(turn._id) && reservation.state === 'reserved') {
        await this.applySettlement(reservation, { kind: 'unknown', reason: 'expired conversation' }, 'delivery_unknown');
      }
    }
    if (turn.reply) {
      const finalMessages = [...turn.payload.messages, { role: 'assistant', content: turn.reply, sourceSnapshots: turn.payload.sourceSnapshots }];
      let chat = await Chat.findOne({ _id: turn.chatId, userId: turn.userId, lastDiscoveryTurnId: turn._id });
      if (!chat && await isNoteDiscoveryAccessGranted(String(turn.userId)) && await NoteDiscoveryChatTurn.exists({
        _id: turn._id, status: 'running', executionCancelled: { $ne: true }, cleanupRequested: { $ne: true },
      })) chat = await Chat.findOneAndUpdate({ _id: turn.chatId, userId: turn.userId, __v: turn.payload.baseVersion },
        { $set: { messages: finalMessages, lastDiscoveryTurnId: turn._id }, $inc: { __v: 1 } }, { new: true, writeConcern });
      if (chat) {
        await NoteDiscoveryChatTurn.updateOne({ _id: turn._id, status: 'running' }, { $set: { status: 'completed' } }, { writeConcern });
        return;
      }
    }
    // The insertion itself checks Mongo's clock against this immutable deadline.
    await NoteDiscoveryChatTurn.updateOne({ _id: turn._id, status: 'running', leaseUntil: { $lte: this.now() } },
      { $set: { status: 'failed', errorCode: 'CHAT_ATTEMPT_EXPIRED' } });
  }

  async settle(
    reservationId: string, generation: number, usage: UsageResult, delivery?: ProviderDeliveryDisposition,
  ): Promise<void> {
    const reservation = await this.findReservation(reservationId);
    if (!reservation || reservation.generation !== generation) return;
    if (reservation.state === 'settled') {
      if (reservation.outcome === 'overrun') throw new DiscoveryBudgetOverrunError();
      return;
    }
    const operationModel: typeof NoteDiscoveryChatTurn = reservation.operationKind === 'conversation' ? NoteDiscoveryChatTurn : NoteDiscoveryRun;
    const current = await operationModel.exists({
      _id: reservation.runId, userId: reservation.userId, generation, status: 'running',
      leaseToken: reservation.leaseToken, leaseUntil: { $gt: this.now() }, recoveringGeneration: null,
    });
    if (!current) return;
    const disposition = delivery && PROVIDER_DELIVERY_DISPOSITIONS.includes(delivery)
      ? delivery
      : 'delivery_unknown';
    await this.applySettlement(reservation, usage, disposition);
  }

  /** The original caller did not dispatch. Its exact reservation can be refunded even after lease expiry. */
  async releaseUnsent(fence: DiscoveryRunFence, reservationId: string): Promise<void> {
    try {
      const reservation = await this.findReservation(reservationId);
      if (reservation?.state !== 'reserved' || !this.matchesFence(reservation, fence)) return;
      await this.applySettlement(reservation, { kind: 'known', inputTokens: 0, outputTokens: 0, costCnyMicros: 0 }, 'not_sent');
    } catch {
      throw new DiscoveryReservationRecoveryError();
    }
  }

  async isDispatchableReservation(fence: DiscoveryRunFence, reservationId: string): Promise<boolean> {
    const reservation = await this.findReservation(reservationId);
    return !!reservation && this.matchesFence(reservation, fence)
      && reservation.state === 'reserved' && !(await this.blocked());
  }

  async settledDelivery(fence: DiscoveryRunFence, reservationId: string): Promise<ProviderDeliveryDisposition | null> {
    const reservation = await this.findReservation(reservationId);
    if (!reservation || !this.matchesFence(reservation, fence) || reservation.state !== 'settled') return null;
    return reservation.delivery ?? 'delivery_unknown';
  }

  async settleExpiredGeneration(fence: DiscoveryRunFence, generation: number): Promise<void> {
    const authorized = generation < fence.generation && await NoteDiscoveryRun.exists({
      _id: fence.runId, userId: fence.userId, status: 'running', leaseToken: fence.leaseToken,
      generation: fence.generation, leaseUntil: { $gt: this.now() }, recoveringGeneration: generation,
    });
    if (!authorized) return;
    const runId = authorized._id;
    const ledgers = await NoteDiscoveryBudget.aggregate<{ reservations: BudgetReservation[] }>([
      { $match: { reservations: { $elemMatch: { runId, generation, state: 'reserved' } } } },
      { $project: { reservations: { $filter: {
        input: '$reservations', as: 'attempt', cond: { $and: [
          { $eq: ['$$attempt.runId', runId] },
          { $eq: ['$$attempt.generation', generation] },
          { $ne: ['$$attempt.operationKind', 'conversation'] },
          { $eq: ['$$attempt.state', 'reserved'] },
        ] },
      } } } },
    ]);
    for (const { reservations } of ledgers) {
      for (const reservation of reservations) {
        await this.applySettlement(reservation, { kind: 'unknown', reason: 'expired lease' }, 'delivery_unknown');
      }
    }
  }

  private matchesFence(reservation: BudgetReservation, fence: DiscoveryRunFence): boolean {
    return reservation.runId.equals(fence.runId) && reservation.userId.equals(fence.userId)
      && reservation.generation === fence.generation && reservation.leaseToken === fence.leaseToken;
  }

  private async blocked(): Promise<boolean> {
    return !!await NoteDiscoveryBudget.exists({ blockedAt: { $exists: true } });
  }

  private async ensureLedger(day: string): Promise<void> {
    try {
      await NoteDiscoveryBudget.updateOne({ _id: day }, {
        $setOnInsert: { users: {}, reservedTotalMicros: 0, spentTotalMicros: 0, reservations: [] },
      }, { upsert: true });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
  }

  private async findReservation(id: string): Promise<BudgetReservation | undefined> {
    const day = reservationDay(id);
    if (!day) return undefined;
    const ledger = await NoteDiscoveryBudget.findOne({
      _id: day, 'reservations.id': id,
    }, { 'reservations.$': 1 }).lean();
    return ledger?.reservations[0];
  }

  private async applySettlement(
    reservation: BudgetReservation, usage: UsageResult, delivery: ProviderDeliveryDisposition,
  ): Promise<void> {
    const { id, day, generation, reservedMicros, userId } = reservation;
    const reportedCost = usage?.kind === 'known' && nonnegativeInteger(usage.costCnyMicros) ? usage.costCnyMicros : null;
    const overrun = reportedCost !== null && reportedCost > reservedMicros;
    const validUsage = usage?.kind === 'known' && reportedCost !== null
      && nonnegativeInteger(usage.inputTokens) && usage.inputTokens <= reservation.maxInputTokens
      && nonnegativeInteger(usage.outputTokens) && usage.outputTokens <= reservation.maxOutputTokens;
    const settledMicros = (overrun || validUsage) && reportedCost !== null ? reportedCost : reservedMicros;
    const outcome = overrun ? 'overrun' : validUsage ? 'known' : 'unknown';
    const fields = { state: 'settled', settledAt: this.now(), settledMicros, outcome, delivery };
    const userKey = `users.${userId.toHexString()}`;
    // Cap the numeric aggregate at the maximum safe integer if a reported overrun is extreme.
    // The individual attempt retains its exact charge and the ledger remains blocked.
    const spentWithCharge = (field: string) => ({ $min: [MAX_SAFE, { $add: [field, settledMicros] }] });
    const result = await NoteDiscoveryBudget.findOneAndUpdate({
      _id: day, reservations: { $elemMatch: { id, generation, state: 'reserved' } },
    }, [{
      $set: {
        reservedTotalMicros: { $subtract: ['$reservedTotalMicros', reservedMicros] },
        spentTotalMicros: spentWithCharge('$spentTotalMicros'),
        [`${userKey}.reservedMicros`]: { $subtract: [`$${userKey}.reservedMicros`, reservedMicros] },
        [`${userKey}.spentMicros`]: spentWithCharge(`$${userKey}.spentMicros`),
        reservations: { $map: {
          input: '$reservations', as: 'attempt', in: { $cond: [
            { $eq: ['$$attempt.id', id] }, { $mergeObjects: ['$$attempt', fields] }, '$$attempt',
          ] },
        } },
        ...(overrun ? { blockedAt: { $ifNull: ['$blockedAt', fields.settledAt] } } : {}),
      },
    }], { projection: { _id: 1 }, writeConcern }).lean();
    if (result && overrun) {
      logger.error(`Discovery budget blocked because a provider charge exceeded the reservation for ${day}`);
      throw new DiscoveryBudgetOverrunError();
    }
    if (!result && overrun && (await this.findReservation(id))?.outcome === 'overrun') {
      throw new DiscoveryBudgetOverrunError();
    }
  }
}

export const noteDiscoveryBudgetService = new NoteDiscoveryBudgetService({
  enabled: config.NOTE_DISCOVERY_RUNNABLE,
  userCapMicros: config.NOTE_DISCOVERY_USER_DAILY_CNY_MICROS,
  globalCapMicros: config.NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS,
  attemptCapMicros: config.NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS,
});

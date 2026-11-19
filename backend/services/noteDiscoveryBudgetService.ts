import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { config } from '../config';
import NoteDiscoveryBudget, { type BudgetReservation } from '../models/NoteDiscoveryBudget';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import type { DiscoveryRunFence } from '../types/noteDiscovery';
import logger from '../utils/logger';

export type { BudgetReservation } from '../models/NoteDiscoveryBudget';

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

const MAX_RESERVATIONS = 10_000;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
// Settlement adds a timestamp, amount and short outcome to each reservation.
const SETTLEMENT_BYTES_PER_RESERVATION = 100;
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

export class NoteDiscoveryBudgetService {
  constructor(
    private readonly settings: BudgetSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(runId: string, userId: string, generation: number, estimate: CostEstimate): Promise<BudgetReservation | null> {
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
    const createdAt = this.now();
    const owner = new Types.ObjectId(userId);
    const run = await NoteDiscoveryRun.findOne({
      _id: runId, userId: owner, generation, status: 'running', leaseUntil: { $gt: createdAt },
      recoveringGeneration: null,
    }, { leaseUntil: 1, leaseToken: 1 }).lean();
    if (!run?.leaseToken || !run.leaseUntil || await this.blocked()) return null;

    const day = createdAt.toISOString().slice(0, 10);
    const reservation: BudgetReservation = {
      id: `${day}:${randomUUID()}`, day, runId: run._id, userId: owner, generation,
      leaseToken: run.leaseToken, leaseUntil: run.leaseUntil, provider: estimate.provider, model: estimate.model,
      maxInputTokens: estimate.maxInputTokens, maxOutputTokens: estimate.maxOutputTokens,
      reservedMicros: amount, state: 'reserved', createdAt,
    };
    await this.ensureLedger(day);
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
    const added = await NoteDiscoveryBudget.findOneAndUpdate({
      _id: day, blockedAt: { $exists: false },
      $expr: { $and: [
        { $lte: [{ $add: ['$spentTotalMicros', '$reservedTotalMicros'] }, globalCapMicros - amount] },
        { $lte: [{ $add: [userSpent, userReserved] }, userCapMicros - amount] },
        { $lt: [count, MAX_RESERVATIONS] },
        roomForReservation,
      ] },
    }, [{
      $set: {
        reservedTotalMicros: { $add: ['$reservedTotalMicros', amount] },
        users: addedUsers,
        reservations: addedReservations,
      },
    }], { projection: { _id: 1 }, writeConcern }).lean();
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
    const stillCurrent = await NoteDiscoveryRun.exists({
      _id: run._id, userId: owner, generation, status: 'running', leaseToken: run.leaseToken,
      leaseUntil: { $gt: this.now() }, recoveringGeneration: null,
    });
    if (!stillCurrent || await this.blocked()) {
      await this.applySettlement(reservation, { kind: 'known', inputTokens: 0, outputTokens: 0, costCnyMicros: 0 });
      return null;
    }
    return reservation;
  }

  async settle(reservationId: string, generation: number, usage: UsageResult): Promise<void> {
    const reservation = await this.findReservation(reservationId);
    if (!reservation || reservation.generation !== generation) return;
    if (reservation.state === 'settled') {
      if (reservation.outcome === 'overrun') throw new DiscoveryBudgetOverrunError();
      return;
    }
    const current = await NoteDiscoveryRun.exists({
      _id: reservation.runId, userId: reservation.userId, generation, status: 'running',
      leaseToken: reservation.leaseToken, leaseUntil: { $gt: this.now() }, recoveringGeneration: null,
    });
    if (current) await this.applySettlement(reservation, usage);
  }

  async isDispatchableReservation(fence: DiscoveryRunFence, reservationId: string): Promise<boolean> {
    const reservation = await this.findReservation(reservationId);
    return !!reservation && this.matchesFence(reservation, fence)
      && reservation.state === 'reserved' && !(await this.blocked());
  }

  async isSettledReservation(fence: DiscoveryRunFence, reservationId: string): Promise<boolean> {
    const reservation = await this.findReservation(reservationId);
    return !!reservation && this.matchesFence(reservation, fence) && reservation.state === 'settled';
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
          { $eq: ['$$attempt.state', 'reserved'] },
        ] },
      } } } },
    ]);
    for (const { reservations } of ledgers) {
      for (const reservation of reservations) {
        await this.applySettlement(reservation, { kind: 'unknown', reason: 'expired lease' });
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

  private async applySettlement(reservation: BudgetReservation, usage: UsageResult): Promise<void> {
    const { id, day, generation, reservedMicros, userId } = reservation;
    const reportedCost = usage?.kind === 'known' && nonnegativeInteger(usage.costCnyMicros) ? usage.costCnyMicros : null;
    const overrun = reportedCost !== null && reportedCost > reservedMicros;
    const validUsage = usage?.kind === 'known' && reportedCost !== null
      && nonnegativeInteger(usage.inputTokens) && usage.inputTokens <= reservation.maxInputTokens
      && nonnegativeInteger(usage.outputTokens) && usage.outputTokens <= reservation.maxOutputTokens;
    const settledMicros = (overrun || validUsage) && reportedCost !== null ? reportedCost : reservedMicros;
    const outcome = overrun ? 'overrun' : validUsage ? 'known' : 'unknown';
    const fields = { state: 'settled', settledAt: this.now(), settledMicros, outcome };
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

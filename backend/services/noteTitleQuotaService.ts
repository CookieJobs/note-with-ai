import { randomUUID } from 'crypto';
import { NoteTitleQuota } from '../models/NoteTitleQuota';

export type TitleQuotaPermit = { ownerToken: string; release: () => Promise<void> };
export type TitleQuotaResult = { permit: TitleQuotaPermit } | { retryAfterSeconds: number };
export interface TitleQuotaStore { acquire(userId: string, now?: Date): Promise<TitleQuotaResult> }

export function titleQuotaRetryAfterSeconds(
  blocked: { attempts?: Date[]; busyUntil?: Date | null },
  now: Date,
): number {
  const nowMs = now.getTime();
  const times = (blocked.attempts || []).map(value => new Date(value).getTime()).filter(Number.isFinite);
  const minute = times.filter(value => value > nowMs - 60_000);
  const hour = times.filter(value => value > nowMs - 3_600_000);
  const waits = [
    blocked.busyUntil ? new Date(blocked.busyUntil).getTime() - nowMs : 0,
    minute.length >= 5 ? Math.min(...minute) + 60_000 - nowMs : 0,
    hour.length >= 30 ? Math.min(...hour) + 3_600_000 - nowMs : 0,
  ].filter(value => Number.isFinite(value) && value > 0);
  return waits.length ? Math.max(1, Math.ceil(Math.max(...waits) / 1000)) : 1;
}

let indexesReady: Promise<unknown> | undefined;
function ensureIndex(): Promise<unknown> {
  if (!indexesReady) indexesReady = NoteTitleQuota.collection.createIndex({ userId: 1 }, { unique: true }).catch((error: unknown) => {
    indexesReady = undefined;
    throw error;
  });
  return indexesReady;
}

export class NoteTitleQuotaService implements TitleQuotaStore {
  async acquire(userId: string, now = new Date()): Promise<TitleQuotaResult> {
    await ensureIndex();
    const token = randomUUID();
    const minute = new Date(now.getTime() - 60_000);
    const hour = new Date(now.getTime() - 3_600_000);
    try {
      await NoteTitleQuota.collection.updateOne({ userId }, { $setOnInsert: { userId, attempts: [], ownerToken: null, busyUntil: null } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const attempts = { $ifNull: ['$attempts', []] };
    const recent = (since: Date) => ({ $filter: { input: attempts, as: 'at', cond: { $gt: ['$$at', since] } } });
    const filter = {
      userId,
      $expr: { $and: [
        { $lte: [{ $ifNull: ['$busyUntil', new Date(0)] }, now] },
        { $lt: [{ $size: recent(minute) }, 5] },
        { $lt: [{ $size: recent(hour) }, 30] },
      ] },
    };
    const row = await NoteTitleQuota.collection.findOneAndUpdate(filter, [{ $set: {
      attempts: { $concatArrays: [recent(hour), [now]] },
      ownerToken: token,
      busyUntil: new Date(now.getTime() + 30_000),
    } }], { returnDocument: 'after' });
    if (row) return { permit: { ownerToken: token, release: async () => {
      await NoteTitleQuota.collection.updateOne({ userId, ownerToken: token }, { $set: { ownerToken: null, busyUntil: null } });
    } } };
    const blocked = await NoteTitleQuota.collection.findOne({ userId });
    if (!blocked) throw new Error('quota row disappeared');
    return { retryAfterSeconds: titleQuotaRetryAfterSeconds(blocked as { attempts?: Date[]; busyUntil?: Date | null }, now) };
  }
}

export const noteTitleQuotaService = new NoteTitleQuotaService();

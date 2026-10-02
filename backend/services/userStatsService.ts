import { Types } from 'mongoose';
import { Note } from '../models/Note';

const PRODUCT_TIMEZONE = 'Asia/Shanghai';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_UTC_OFFSET_IN_MS = 8 * 60 * 60 * 1000;

export interface UserStatsDto {
  totalNotes: number;
  notesThisMonth: number;
}

interface AggregateResult {
  totals: Array<{ count: number }>;
  monthCount: Array<{ count: number }>;
}

function toDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

function toDayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_IN_MS);
}

export function calculateStreakMetrics(
  dateKeys: string[],
  now: Date = new Date(),
  timeZone: string = PRODUCT_TIMEZONE
): { streakDays: number; maxStreak: number } {
  const sortedKeys = [...dateKeys].sort();
  const keySet = new Set(sortedKeys);

  let streakDays = 0;
  const checkDate = new Date(now);
  checkDate.setDate(checkDate.getDate() - 1);

  while (keySet.has(toDateKey(checkDate, timeZone))) {
    streakDays += 1;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  let maxStreak = 0;
  let currentStreak = 0;

  for (let index = 0; index < sortedKeys.length; index += 1) {
    if (index === 0) {
      currentStreak = 1;
    } else {
      const previousDay = toDayNumber(sortedKeys[index - 1]);
      const currentDay = toDayNumber(sortedKeys[index]);
      currentStreak = currentDay - previousDay === 1 ? currentStreak + 1 : 1;
    }

    maxStreak = Math.max(maxStreak, currentStreak);
  }

  return { streakDays, maxStreak };
}

function getShanghaiMonthBounds(now: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PRODUCT_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const startUtc = Date.UTC(year, month - 1, 1);
  const endUtc = Date.UTC(year, month, 1);

  return {
    start: new Date(startUtc - SHANGHAI_UTC_OFFSET_IN_MS),
    end: new Date(endUtc - SHANGHAI_UTC_OFFSET_IN_MS),
  };
}

class UserStatsService {
  async getStats(userId: string, options: { now?: Date } = {}): Promise<UserStatsDto> {
    const { start: monthStart, end: monthEnd } = getShanghaiMonthBounds(options.now ?? new Date());
    const [aggregated] = await Note.aggregate<AggregateResult>([
      { $match: { userId: new Types.ObjectId(userId) } },
      {
        $facet: {
          totals: [{ $count: 'count' }],
          monthCount: [
            { $match: { createdAt: { $gte: monthStart, $lt: monthEnd } } },
            { $count: 'count' },
          ],
        },
      },
    ]);

    return {
      totalNotes: aggregated?.totals?.[0]?.count ?? 0,
      notesThisMonth: aggregated?.monthCount?.[0]?.count ?? 0,
    };
  }
}

export const userStatsService = new UserStatsService();

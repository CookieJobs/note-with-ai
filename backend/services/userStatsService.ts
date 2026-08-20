import { Types } from 'mongoose';
import { Note } from '../models/Note';
import UserProfile from '../models/UserProfile';

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface UserStatsDto {
  totalNotes: number;
  notesThisMonth: number;
  notesThisWeek: number;
  streakDays: number;
  maxStreak: number;
  totalWords: number;
  avgWordsPerNote: number;
  interestCount: number;
  lastAnalyzedAt: Date | null;
}

interface AggregateBucket {
  count: number;
}

interface AggregateTotals {
  totalNotes: number;
  totalWords: number;
}

interface AggregateResult {
  totals: AggregateTotals[];
  monthCount: AggregateBucket[];
  weekCount: AggregateBucket[];
  dailyBuckets: Array<{ _id: string }>;
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
  timeZone: string = DEFAULT_TIMEZONE
): Pick<UserStatsDto, 'streakDays' | 'maxStreak'> {
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

function createWordSourceExpression() {
  return {
    $let: {
      vars: {
        normalizedContentText: {
          $trim: { input: { $ifNull: ['$contentText', ''] } },
        },
      },
      in: {
        $cond: [
          { $gt: [{ $strLenCP: '$$normalizedContentText' }, 0] },
          '$$normalizedContentText',
          { $ifNull: ['$content', ''] },
        ],
      },
    },
  };
}

class UserStatsService {
  async getStats(
    userId: string,
    options: { now?: Date; timeZone?: string } = {}
  ): Promise<UserStatsDto> {
    const now = options.now ?? new Date();
    const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const [aggregated, profile] = await Promise.all([
      Note.aggregate<AggregateResult>([
        { $match: { userId: new Types.ObjectId(userId) } },
        {
          $project: {
            createdAt: 1,
            wordSource: createWordSourceExpression(),
          },
        },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  totalNotes: { $sum: 1 },
                  totalWords: { $sum: { $strLenCP: '$wordSource' } },
                },
              },
              {
                $project: {
                  _id: 0,
                  totalNotes: 1,
                  totalWords: 1,
                },
              },
            ],
            monthCount: [
              { $match: { createdAt: { $gte: monthStart } } },
              { $count: 'count' },
            ],
            weekCount: [
              { $match: { createdAt: { $gte: weekStart } } },
              { $count: 'count' },
            ],
            dailyBuckets: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$createdAt',
                      timezone: timeZone,
                    },
                  },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]).then((result) => result[0]),
      UserProfile.findOne({ userId }).select('interests lastAnalyzedAt').lean(),
    ]);

    const totals = aggregated?.totals?.[0] ?? { totalNotes: 0, totalWords: 0 };
    const notesThisMonth = aggregated?.monthCount?.[0]?.count ?? 0;
    const notesThisWeek = aggregated?.weekCount?.[0]?.count ?? 0;
    const { streakDays, maxStreak } = calculateStreakMetrics(
      aggregated?.dailyBuckets?.map((bucket) => bucket._id) ?? [],
      now,
      timeZone
    );

    return {
      totalNotes: totals.totalNotes,
      notesThisMonth,
      notesThisWeek,
      streakDays,
      maxStreak,
      totalWords: totals.totalWords,
      avgWordsPerNote:
        totals.totalNotes > 0 ? Math.round(totals.totalWords / totals.totalNotes) : 0,
      interestCount: profile?.interests?.length || 0,
      lastAnalyzedAt: profile?.lastAnalyzedAt || null,
    };
  }
}

export const userStatsService = new UserStatsService();

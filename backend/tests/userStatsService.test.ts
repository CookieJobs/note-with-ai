import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

global.setInterval = (((_callback: (...args: any[]) => void, _ms?: number, ..._args: any[]) => {
  return 0 as any;
}) as typeof setInterval);

async function loadModules() {
  return {
    Note: require('../models/Note').Note,
    UserProfile: require('../models/UserProfile').default,
    userStatsService: require('../services/userStatsService').userStatsService,
    calculateStreakMetrics: require('../services/userStatsService').calculateStreakMetrics,
  };
}

describe('userStatsService', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('会基于聚合结果返回统计信息，并保留连续记录口径', async () => {
    const { Note, UserProfile, userStatsService } = await loadModules();

    let receivedPipeline: Record<string, unknown>[] = [];
    mock.method(Note, 'aggregate', async (pipeline: Record<string, unknown>[]) => {
      receivedPipeline = pipeline;
      return [
        {
          totals: [{ totalNotes: 4, totalWords: 120 }],
          monthCount: [{ count: 2 }],
          weekCount: [{ count: 1 }],
          dailyBuckets: [
            { _id: '2026-07-27' },
            { _id: '2026-07-28' },
            { _id: '2026-07-29' },
            { _id: '2026-07-31' },
          ],
        },
      ];
    });

    mock.method(UserProfile, 'findOne', () => ({
      select() {
        return this;
      },
      lean: async () => ({
        interests: [{ topic: '写作', score: 0.8 }, { topic: '复盘', score: 0.6 }],
        lastAnalyzedAt: new Date('2026-07-30T08:00:00.000Z'),
      }),
    }) as any);

    const stats = await userStatsService.getStats('507f1f77bcf86cd799439011', {
      now: new Date('2026-08-01T12:00:00.000Z'),
      timeZone: 'UTC',
    });

    assert.deepEqual(stats, {
      totalNotes: 4,
      notesThisMonth: 2,
      notesThisWeek: 1,
      streakDays: 1,
      maxStreak: 3,
      totalWords: 120,
      avgWordsPerNote: 30,
      interestCount: 2,
      lastAnalyzedAt: new Date('2026-07-30T08:00:00.000Z'),
    });

    assert.equal(
      ((receivedPipeline[0] as any)?.$match?.userId as { toHexString: () => string }).toHexString(),
      '507f1f77bcf86cd799439011'
    );
    assert.equal(
      (receivedPipeline[2] as any)?.$facet?.dailyBuckets?.[0]?.$group?._id?.$dateToString?.timezone,
      'UTC'
    );
    assert.ok((receivedPipeline[1] as any)?.$project?.wordSource);
  });

  it('在没有笔记和画像时返回零值统计', async () => {
    const { Note, UserProfile, userStatsService } = await loadModules();

    mock.method(Note, 'aggregate', async () => [
      {
        totals: [],
        monthCount: [],
        weekCount: [],
        dailyBuckets: [],
      },
    ]);

    mock.method(UserProfile, 'findOne', () => ({
      select() {
        return this;
      },
      lean: async () => null,
    }) as any);

    const stats = await userStatsService.getStats('507f1f77bcf86cd799439011', {
      now: new Date('2026-08-01T12:00:00.000Z'),
      timeZone: 'UTC',
    });

    assert.deepEqual(stats, {
      totalNotes: 0,
      notesThisMonth: 0,
      notesThisWeek: 0,
      streakDays: 0,
      maxStreak: 0,
      totalWords: 0,
      avgWordsPerNote: 0,
      interestCount: 0,
      lastAnalyzedAt: null,
    });
  });

  it('会从昨天开始计算连续记录，但最长连续保留完整历史', async () => {
    const { calculateStreakMetrics } = await loadModules();

    const metrics = calculateStreakMetrics(
      ['2026-07-20', '2026-07-21', '2026-07-23', '2026-07-24', '2026-07-25'],
      new Date('2026-07-26T09:00:00.000Z'),
      'UTC'
    );

    assert.deepEqual(metrics, {
      streakDays: 3,
      maxStreak: 3,
    });
  });
});

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

  it('仅返回笔记总数和上海时区本月笔记数', async () => {
    const { Note, UserProfile, userStatsService } = await loadModules();
    let profileQueries = 0;

    mock.method(Note, 'aggregate', async () => [
      { totals: [{ count: 4 }], monthCount: [{ count: 2 }] },
    ]);
    mock.method(UserProfile, 'findOne', () => {
      profileQueries += 1;
      return { select() { return this; }, lean: async () => null } as any;
    });

    const stats = await userStatsService.getStats('507f1f77bcf86cd799439011', {
      now: new Date('2026-08-01T16:00:00.000Z'),
    });

    assert.deepEqual(stats, { totalNotes: 4, notesThisMonth: 2 });
    assert.equal(profileQueries, 0);
  });

  it('不受主机时区影响地使用上海时区边界', async () => {
    const { Note, UserProfile, userStatsService } = await loadModules();
    let receivedPipeline: Record<string, unknown>[] = [];
    let profileQueries = 0;

    mock.method(Note, 'aggregate', async (pipeline: Record<string, unknown>[]) => {
      receivedPipeline = pipeline;
      return [{ totals: [{ count: 1 }], monthCount: [{ count: 1 }] }];
    });
    mock.method(UserProfile, 'findOne', () => {
      profileQueries += 1;
      return { select() { return this; }, lean: async () => null } as any;
    });

    const originalTimezone = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      await userStatsService.getStats('507f1f77bcf86cd799439011', {
        now: new Date('2026-08-01T16:00:00.000Z'),
      });
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }

    assert.deepEqual((receivedPipeline[1] as any)?.$facet?.monthCount?.[0]?.$match?.createdAt, {
      $gte: new Date('2026-07-31T16:00:00.000Z'),
      $lt: new Date('2026-08-31T16:00:00.000Z'),
    });
    assert.equal(profileQueries, 0);
  });

  it('会基于聚合结果返回笔记统计', async () => {
    const { Note, userStatsService } = await loadModules();
    let receivedPipeline: Record<string, unknown>[] = [];

    mock.method(Note, 'aggregate', async (pipeline: Record<string, unknown>[]) => {
      receivedPipeline = pipeline;
      return [{ totals: [{ count: 4 }], monthCount: [{ count: 2 }] }];
    });

    const stats = await userStatsService.getStats('507f1f77bcf86cd799439011', {
      now: new Date('2026-08-01T12:00:00.000Z'),
    });

    assert.deepEqual(stats, { totalNotes: 4, notesThisMonth: 2 });
    assert.equal(
      ((receivedPipeline[0] as any)?.$match?.userId as { toHexString: () => string }).toHexString(),
      '507f1f77bcf86cd799439011'
    );
    assert.ok((receivedPipeline[1] as any)?.$facet?.monthCount);
  });

  it('在没有笔记时返回零值统计', async () => {
    const { Note, userStatsService } = await loadModules();

    mock.method(Note, 'aggregate', async () => [{ totals: [], monthCount: [] }]);

    const stats = await userStatsService.getStats('507f1f77bcf86cd799439011', {
      now: new Date('2026-08-01T12:00:00.000Z'),
    });

    assert.deepEqual(stats, { totalNotes: 0, notesThisMonth: 0 });
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

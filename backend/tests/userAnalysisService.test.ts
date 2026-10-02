import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-deepseek-key';
process.env.DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://example.com';

global.setInterval = (((_callback: (...args: any[]) => void, _ms?: number, ..._args: any[]) => {
  return 0 as any;
}) as typeof setInterval);

const manualRestores: Array<() => void> = [];

async function loadModules() {
  return {
    Note: require('../models/Note').Note,
    UserProfile: require('../models/UserProfile').default,
    userAnalysisService: require('../services/userAnalysisService').userAnalysisService,
  };
}

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  manualRestores.push(() => {
    (target as any)[key] = original;
  });
}

describe('userAnalysisService', () => {
  afterEach(() => {
    mock.restoreAll();
    while (manualRestores.length > 0) {
      manualRestores.pop()?.();
    }
  });

  it('笔记不足时不生成画像且不写入分析时间', async () => {
    const { Note, UserProfile, userAnalysisService } = await loadModules();

    mock.method(Note, 'find', () => ({
      sort() {
        return this;
      },
      limit: async () => [],
    }) as any);
    mock.method(Note, 'countDocuments', async () => 4);

    const updateCalls: Array<{ filter: Record<string, unknown>; update: Record<string, any> }> = [];
    mock.method(UserProfile, 'updateOne', async (filter: Record<string, unknown>, update: Record<string, any>) => {
      updateCalls.push({ filter, update });
      return { matchedCount: 1 } as any;
    });

    const result = await userAnalysisService.analyzeUserProfile({
      userId: 'user-1',
      analysisVersion: 3,
    });

    assert.deepEqual(result, { committed: false, reason: 'insufficient_data' });
    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].filter, {
      userId: 'user-1',
      analysisVersion: 3,
      analysisStatus: 'running',
    });
    assert.equal(updateCalls[0].update.$set.analysisStatus, 'failed');
    assert.equal(updateCalls[0].update.$set.analysisError, '笔记数量不足，未生成画像');
    assert.equal('lastAnalyzedAt' in updateCalls[0].update.$set, false);
  });

  it('写回前笔记数降至五篇以下时分析不提交', async () => {
    const { Note, UserProfile, userAnalysisService } = await loadModules();
    const notes = Array.from({ length: 5 }, (_, index) => ({
      createdAt: new Date(`2026-01-0${index + 1}T00:00:00.000Z`),
      title: `Note ${index + 1}`,
      content: `内容${index + 1}`,
    }));
    let countCalls = 0;
    mock.method(Note, 'countDocuments', async () => ++countCalls === 1 ? 5 : 4);
    mock.method(Note, 'find', () => ({ sort() { return this; }, limit: async () => notes }) as any);
    replaceMethod(userAnalysisService as any, 'getApiClient', (() => ({
      chatCompletion: async () => JSON.stringify({ summary: '生成结果' }),
    })) as any);
    const updates: Array<{ filter: Record<string, unknown>; update: Record<string, any> }> = [];
    mock.method(UserProfile, 'updateOne', async (filter: Record<string, unknown>, update: Record<string, any>) => {
      updates.push({ filter, update });
      return { matchedCount: 1 } as any;
    });

    const result = await userAnalysisService.analyzeUserProfile({ userId: 'user-1', analysisVersion: 8 });

    assert.deepEqual(result, { committed: false, reason: 'insufficient_data' });
    assert.equal(countCalls, 2);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].update.$set.analysisStatus, 'failed');
    assert.equal('summary' in updates[0].update.$set, false);
    assert.equal('lastAnalyzedAt' in updates[0].update.$set, false);
  });

  it('成功提交画像时记录实际输入笔记数和范围', async () => {
    const { Note, UserProfile, userAnalysisService } = await loadModules();
    const notes = Array.from({ length: 7 }, (_, index) => ({
      createdAt: new Date(`2026-01-0${index + 1}T00:00:00.000Z`),
      title: `Note ${index + 1}`,
      content: `内容${index + 1}`,
    }));
    mock.method(Note, 'countDocuments', async () => 7);
    mock.method(Note, 'find', () => ({ sort() { return this; }, limit: async () => notes }) as any);
    replaceMethod(userAnalysisService as any, 'getApiClient', (() => ({
      chatCompletion: async () => JSON.stringify({ summary: '生成结果' }),
    })) as any);
    let committedUpdate: Record<string, any> | undefined;
    mock.method(UserProfile, 'updateOne', async (_filter: Record<string, unknown>, update: Record<string, any>) => {
      committedUpdate = update;
      return { matchedCount: 1 } as any;
    });

    const result = await userAnalysisService.analyzeUserProfile({ userId: 'user-1', analysisVersion: 9 });

    assert.deepEqual(result, { committed: true, reason: 'updated' });
    assert.equal(committedUpdate?.$set.analysisInputNoteCount, 7);
    assert.equal(committedUpdate?.$set.analysisInputScope, 'recent_up_to_20');
    assert.ok(committedUpdate?.$set.lastAnalyzedAt instanceof Date);
    assert.equal(committedUpdate?.$set.summary, '生成结果');
  });

  it('模型没有生成可展示画像时不提交或更新时间', async () => {
    const { Note, UserProfile, userAnalysisService } = await loadModules();
    const notes = Array.from({ length: 5 }, (_, index) => ({
      createdAt: new Date(`2026-01-0${index + 1}T00:00:00.000Z`),
      title: `Note ${index + 1}`,
      content: `内容${index + 1}`,
    }));
    const emptyOutputs = [
      '{}',
      '[]',
      'null',
      JSON.stringify({
        summary: '   ',
        interests: [],
        expertise: [],
        theme: { themeName: '空', cssType: 'linear-gradient', cssValue: '  ', reasoning: '' },
      }),
    ];
    let output = '';
    mock.method(Note, 'countDocuments', async () => 5);
    mock.method(Note, 'find', () => ({ sort() { return this; }, limit: async () => notes }) as any);
    replaceMethod(userAnalysisService as any, 'getApiClient', (() => ({
      chatCompletion: async () => output,
    })) as any);
    const updates: Array<Record<string, any>> = [];
    mock.method(UserProfile, 'updateOne', async (_filter: Record<string, unknown>, update: Record<string, any>) => {
      updates.push(update);
      return { matchedCount: 1 } as any;
    });

    for (let index = 0; index < emptyOutputs.length; index += 1) {
      output = emptyOutputs[index];
      await assert.rejects(userAnalysisService.analyzeUserProfile({
        userId: 'user-1',
        analysisVersion: 10 + index,
      }));
    }

    assert.equal(updates.length, 0);
  });

  it('在旧版本结果提交失败时返回 stale_analysis_version，避免覆盖新画像', async () => {
    const { Note, UserProfile, userAnalysisService } = await loadModules();

    const notes = [
      { createdAt: new Date('2026-01-01T00:00:00.000Z'), title: 'A', content: '内容A' },
      { createdAt: new Date('2026-01-02T00:00:00.000Z'), title: 'B', content: '内容B' },
      { createdAt: new Date('2026-01-03T00:00:00.000Z'), title: 'C', content: '内容C' },
      { createdAt: new Date('2026-01-04T00:00:00.000Z'), title: 'D', content: '内容D' },
      { createdAt: new Date('2026-01-05T00:00:00.000Z'), title: 'E', content: '内容E' },
    ];

    mock.method(Note, 'find', () => ({
      sort() {
        return this;
      },
      limit: async () => notes,
    }) as any);
    mock.method(Note, 'countDocuments', async () => 5);

    replaceMethod(userAnalysisService as any, 'getApiClient', (() => ({
      chatCompletion: async () => JSON.stringify({
        interests: [{ topic: '写作', score: 0.9 }],
        expertise: [{ area: '复盘', level: 'Intermediate' }],
        goals: [{ description: '保持记录', timeframe: 'Long-term', status: 'Active' }],
        preferences: {
          communicationStyle: '温和',
          contentFocus: ['反思'],
          feedbackMode: 'Gentle',
        },
        summary: '一个持续记录想法的人。',
        theme: {
          themeName: '雾光清晨',
          cssType: 'linear-gradient',
          cssValue: 'linear-gradient(135deg, #E3F2F1 0%, #F7E9E3 100%)',
          reasoning: '偏安静且有反思感。',
        },
      }),
    })) as any);

    mock.method(UserProfile, 'updateOne', async () => ({ matchedCount: 0 }) as any);

    const result = await userAnalysisService.analyzeUserProfile({
      userId: 'user-1',
      analysisVersion: 7,
    });

    assert.deepEqual(result, {
      committed: false,
      reason: 'stale_analysis_version',
    });
  });
});

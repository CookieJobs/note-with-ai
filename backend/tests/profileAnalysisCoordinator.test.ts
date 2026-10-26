import { afterEach, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import UserProfile from '../models/UserProfile';
import { ProfileAnalysisCoordinator } from '../services/profileAnalysisCoordinator';
import { userAnalysisService } from '../services/userAnalysisService';

const restores: Array<() => void> = [];

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  restores.push(() => { (target as any)[key] = original; });
}

afterEach(() => {
  mock.restoreAll();
  while (restores.length) restores.pop()?.();
});

it('UserProfile persists nullable analysisFailedAt as a date', () => {
  assert.equal(UserProfile.schema.path('analysisFailedAt')?.instance, 'Date');
  assert.equal((UserProfile.schema.path('analysisFailedAt') as any)?.options.default, null);
});

it('coordinator catch stores actual failure time without changing lastAnalyzedAt', async () => {
  mock.method(UserProfile, 'findOneAndUpdate', () => ({ lean: async () => ({ userId: 'user-1' }) }) as any);
  const writes: Array<Record<string, any>> = [];
  mock.method(UserProfile, 'updateOne', async (_filter: Record<string, unknown>, update: Record<string, any>) => {
    writes.push(update);
    return { matchedCount: 1 } as any;
  });
  replaceMethod(userAnalysisService, 'analyzeUserProfile', (async () => { throw new Error('private provider detail'); }) as any);

  await assert.rejects((new ProfileAnalysisCoordinator() as any).runAnalysis('user-1', 7));

  assert.equal(writes.length, 1);
  assert.equal(writes[0].$set.analysisStatus, 'failed');
  assert.ok(writes[0].$set.analysisFailedAt instanceof Date);
  assert.equal('lastAnalyzedAt' in writes[0].$set, false);
});

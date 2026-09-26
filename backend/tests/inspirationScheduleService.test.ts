import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import InspirationSettings from '../models/InspirationSettings';
import { createInspirationScheduleService } from '../services/inspirationScheduleService';

const userId = '507f191e810c19729de860ea';
const now = new Date('2026-09-26T00:00:00.000Z');

function installSettingsStore() {
  let current: Record<string, any> | null = null;
  mock.method(InspirationSettings, 'updateOne', async (_filter: any, update: any) => {
    if (!current && update.$setOnInsert) current = { userId, ...update.$setOnInsert };
    if (current && update.$max && current.enabled && current.nextEligibleAt < update.$max.nextEligibleAt) {
      current.nextEligibleAt = update.$max.nextEligibleAt;
    }
    return { matchedCount: current ? 1 : 0 } as never;
  });
  mock.method(InspirationSettings, 'findOneAndUpdate', async (filter: any, update: any) => {
    if (!current || (filter.enabled !== undefined && current.enabled !== filter.enabled)) return null;
    Object.assign(current, update.$set);
    return current as never;
  });
  mock.method(InspirationSettings, 'findOne', () => ({ lean: async () => current }) as never);
  return { get: () => current };
}

describe('inspiration opt-in settings', () => {
  afterEach(() => mock.restoreAll());

  it('starts disabled and does not schedule a call on enable', async () => {
    const store = installSettingsStore();
    const settings = createInspirationScheduleService({ hasProviders: () => true });
    assert.deepEqual(await settings.get(userId), { enabled: false, consentedAt: null, nextEligibleAt: null, lastAttemptAt: null, lastStatus: null });
    const enabled = await settings.setEnabled(userId, true, now);
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.nextEligibleAt, '2026-09-27T00:00:00.000Z');
    assert.equal(store.get()?.consentedAt.toISOString(), now.toISOString());
    assert.equal((await settings.setEnabled(userId, true, new Date(now.getTime() + 60_000))).nextEligibleAt, enabled.nextEligibleAt);
  });

  it('refuses to opt in without both providers configured', async () => {
    installSettingsStore();
    const settings = createInspirationScheduleService({ hasProviders: () => false });
    await assert.rejects(settings.setEnabled(userId, true, now), (error: any) => error.statusCode === 503);
    assert.equal((await settings.get(userId)).enabled, false);
  });

  it('manual research postpones the next automatic attempt and opt-out stops it', async () => {
    installSettingsStore();
    const settings = createInspirationScheduleService({ hasProviders: () => true });
    await settings.setEnabled(userId, true, now);
    const manualAt = new Date(now.getTime() + 3_600_000);
    await settings.recordManualStart(userId, manualAt);
    assert.equal((await settings.get(userId)).nextEligibleAt, '2026-09-27T01:00:00.000Z');
    assert.equal((await settings.setEnabled(userId, false, manualAt)).enabled, false);
    assert.equal((await settings.get(userId)).nextEligibleAt, null);
  });
});

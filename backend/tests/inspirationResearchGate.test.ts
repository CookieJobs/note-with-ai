import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import InspirationResearchGate from '../models/InspirationResearchGate';
import { createInspirationResearchGate } from '../services/inspirationResearchGate';

const userId = '507f191e810c19729de860ea';
const now = new Date('2026-09-26T00:00:00.000Z');

describe('shared inspiration research gate', () => {
  afterEach(() => mock.restoreAll());

  it('lets one process research a user while another is blocked and releases by owner token', async () => {
    const state = new Map<string, { token: string | null; busyUntil: Date | null }>();
    mock.method(InspirationResearchGate, 'updateOne', async (filter: any, update: any) => {
      if (update.$setOnInsert && !state.has(filter.userId)) state.set(filter.userId, { token: null, busyUntil: null });
      if (update.$set && state.get(filter.userId)?.token === filter.token) Object.assign(state.get(filter.userId)!, update.$set);
      return { matchedCount: 1 } as never;
    });
    mock.method(InspirationResearchGate, 'findOneAndUpdate', async (filter: any, update: any) => {
      const row = state.get(filter.userId)!;
      if (row.busyUntil && row.busyUntil > now) return null;
      Object.assign(row, update.$set);
      return row as never;
    });
    const first = createInspirationResearchGate();
    const second = createInspirationResearchGate();
    const token = await first.acquire(userId, 'manual', now);
    assert.ok(token);
    assert.equal(await second.acquire(userId, 'scheduled', now), null);
    await first.release(userId, 'wrong-token');
    assert.equal(state.get(userId)?.token, token);
    await first.release(userId, token);
    assert.equal(state.get(userId)?.token, null);
  });
});

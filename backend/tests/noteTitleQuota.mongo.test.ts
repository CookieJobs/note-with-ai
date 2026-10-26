import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import { NoteTitleQuota } from '../models/NoteTitleQuota';
import { NoteTitleQuotaService } from '../services/noteTitleQuotaService';

// The only database touched by this integration test is the literal isolated test database.
const DB = 'note_with_ai_optional_titles_test_20261011';
const uri = `mongodb://127.0.0.1:27017/${DB}`;

describe('Mongo account title quota', () => {
  it('atomically arbitrates concurrent owners and prevents stale release', async () => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    const userId = `test-${Date.now()}-${Math.random()}`;
    const hourUserId = `${userId}-hour`;
    const serviceA = new NoteTitleQuotaService(), serviceB = new NoteTitleQuotaService();
    const now = new Date();
    try {
      const [a,b] = await Promise.all([serviceA.acquire(userId, now), serviceB.acquire(userId, now)]);
      assert.equal(Number('permit' in a) + Number('permit' in b), 1);
      const first = 'permit' in a ? a.permit : (b as any).permit;
      const successor = await serviceB.acquire(userId, new Date(now.getTime()+31_000));
      assert.ok('permit' in successor);
      await first.release();
      const blocked = await serviceA.acquire(userId, new Date(now.getTime()+31_100));
      assert.ok('retryAfterSeconds' in blocked);
      if ('permit' in successor) await successor.permit.release();
      for (let i = 0; i < 3; i++) {
        const next = await serviceA.acquire(userId, new Date(now.getTime()+31_200+i));
        assert.ok('permit' in next);
        if ('permit' in next) await next.permit.release();
      }
      const minuteLimited = await serviceB.acquire(userId, new Date(now.getTime()+31_500));
      assert.ok('retryAfterSeconds' in minuteLimited);
      assert.ok('retryAfterSeconds' in minuteLimited && minuteLimited.retryAfterSeconds > 0);
      for (let i = 0; i < 30; i++) {
        const next = await serviceA.acquire(hourUserId, new Date(now.getTime() + i * 61_000));
        assert.ok('permit' in next);
        if ('permit' in next) await next.permit.release();
      }
      const hourLimited = await serviceB.acquire(hourUserId, new Date(now.getTime() + 30 * 61_000));
      assert.ok('retryAfterSeconds' in hourLimited);
    } finally {
      await NoteTitleQuota.collection.deleteMany({userId: {$in: [userId, hourUserId]}});
      await mongoose.disconnect();
    }
  });
});

import { titleQuotaRetryAfterSeconds } from '../services/noteTitleQuotaService';

describe('quota retry guidance', () => {
  it('waits for the latest active blocker and returns finite one second after a CAS race clears', () => {
    const now = new Date('2026-10-12T00:00:00.000Z');
    const attempts = Array.from({length:5},()=>new Date(now.getTime()-1000));
    assert.equal(titleQuotaRetryAfterSeconds({busyUntil:new Date(now.getTime()+30_000),attempts},now),59);
    assert.equal(titleQuotaRetryAfterSeconds({busyUntil:null,attempts:[]},now),1);
    assert.equal(titleQuotaRetryAfterSeconds({busyUntil:new Date(now.getTime()-5000),attempts:[]},now),1);
    assert.equal(titleQuotaRetryAfterSeconds({attempts:Array.from({length:30},()=>new Date(now.getTime()-1000))},now),3599);
  });
});

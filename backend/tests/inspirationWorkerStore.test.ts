import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import InspirationRun from '../models/InspirationRun';
import InspirationSettings from '../models/InspirationSettings';
import { MongoInspirationWorkerStore } from '../services/inspirationWorkerStore';
import type { WorkerRun } from '../services/inspirationWorker';

const attemptAt = new Date('2026-10-13T00:00:00.000Z');
const run: WorkerRun = { id: 'run-1', userId: 'user-1', cycleAt: attemptAt, attemptAt, state: 'claimed', token: 'claim-1' };

describe('inspiration worker store diagnostics', () => {
  afterEach(() => mock.restoreAll());

  it('persists a no-context reason on the run and settings with the existing CAS filters', async () => {
    const writes: unknown[] = [];
    mock.method(InspirationRun, 'updateOne', async (filter: unknown, update: unknown) => {
      writes.push({ target: 'run', filter, update });
      return { modifiedCount: 1 } as never;
    });
    mock.method(InspirationSettings, 'updateOne', async (filter: unknown, update: unknown) => {
      writes.push({ target: 'settings', filter, update });
      return { modifiedCount: 1 } as never;
    });
    await new MongoInspirationWorkerStore().finish(run, 'no_result', {
      reason: 'note_context_unavailable', contextReason: 'summary_pending',
    });
    assert.deepEqual(writes, [
      { target: 'run', filter: { _id: 'run-1', token: 'claim-1', state: { $in: ['claimed', 'provider_started'] } },
        update: { $set: { state: 'no_result', leaseUntil: null, reason: 'note_context_unavailable', contextReason: 'summary_pending' } } },
      { target: 'settings', filter: { userId: 'user-1', lastAttemptAt: attemptAt },
        update: { $set: { lastStatus: 'no_result', lastReason: 'note_context_unavailable', lastContextReason: 'summary_pending' } } },
    ]);
  });

  it('does not overwrite settings if a stale run cannot finish and clears reasons on a normal terminal state', async () => {
    let settingsWrites = 0;
    mock.method(InspirationRun, 'updateOne', async () => ({ modifiedCount: 0 }) as never);
    mock.method(InspirationSettings, 'updateOne', async () => { settingsWrites++; return { modifiedCount: 1 } as never; });
    await new MongoInspirationWorkerStore().finish(run, 'failed');
    assert.equal(settingsWrites, 0);
    mock.restoreAll();
    let runUpdate: any;
    let settingsUpdate: any;
    mock.method(InspirationRun, 'updateOne', async (_filter: unknown, update: unknown) => { runUpdate = update; return { modifiedCount: 1 } as never; });
    mock.method(InspirationSettings, 'updateOne', async (_filter: unknown, update: unknown) => { settingsUpdate = update; return { modifiedCount: 1 } as never; });
    await new MongoInspirationWorkerStore().finish(run, 'completed');
    assert.deepEqual([runUpdate.$set.reason, runUpdate.$set.contextReason, settingsUpdate.$set.lastReason, settingsUpdate.$set.lastContextReason], [null, null, null, null]);
  });
});

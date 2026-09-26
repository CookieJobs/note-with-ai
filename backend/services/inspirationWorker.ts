import { inspirationService } from './inspirationService';
import { mongoInspirationWorkerStore } from './inspirationWorkerStore';

export type WorkerRun = {
  id: string;
  userId: string;
  cycleAt: Date;
  attemptAt?: Date;
  state: 'queued' | 'claimed' | 'provider_started' | 'completed' | 'no_result' | 'failed' | 'cancelled';
  token: string;
  leaseUntil?: Date;
};
export type WorkerSlot = { slot: number; token: string };
export type WorkerOutcome = { status: 'created' | 'no_result' | 'cancelled' };

export interface InspirationWorkerStore {
  scanDue(now: Date): Promise<string[]>;
  claimDue(userId: string, now: Date): Promise<WorkerRun | null>;
  recover(now: Date): Promise<WorkerRun[]>;
  acquireSlot(now: Date): Promise<WorkerSlot | null>;
  releaseSlot(slot: WorkerSlot): Promise<void>;
  reserveBudget(now: Date): Promise<boolean>;
  refundBudget(now: Date): Promise<void>;
  defer(userId: string, next: Date): Promise<void>;
  markProviderStarted(run: WorkerRun): Promise<boolean>;
  finish(run: WorkerRun, status: 'completed' | 'no_result' | 'failed' | 'cancelled'): Promise<void>;
}

type WorkerOptions = {
  store: InspirationWorkerStore;
  runResearch: (userId: string, canContinue: () => Promise<boolean>) => Promise<WorkerOutcome>;
};

function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export class InspirationWorker {
  constructor(private readonly options: WorkerOptions) {}

  async tick(now: Date = new Date()): Promise<void> {
    const recovered = await this.options.store.recover(now);
    for (const run of recovered) {
      const slot = await this.options.store.acquireSlot(now);
      if (!slot) break;
      try { await this.execute(run); }
      finally { await this.options.store.releaseSlot(slot); }
    }
    const due = await this.options.store.scanDue(now);
    for (const userId of due) {
      const slot = await this.options.store.acquireSlot(now);
      if (!slot) break;
      try {
        if (!await this.options.store.reserveBudget(now)) {
          await this.options.store.defer(userId, nextUtcDay(now));
          continue;
        }
        let run: WorkerRun | null;
        try {
          run = await this.options.store.claimDue(userId, now);
        } catch (error) {
          await this.options.store.refundBudget(now);
          throw error;
        }
        if (!run) {
          await this.options.store.refundBudget(now);
          continue;
        }
        await this.execute(run);
      } finally {
        await this.options.store.releaseSlot(slot);
      }
    }
  }

  private async execute(run: WorkerRun): Promise<void> {
    try {
      const result = await this.options.runResearch(run.userId,
        async () => this.options.store.markProviderStarted(run));
      const status = result.status === 'created' ? 'completed' : result.status;
      await this.options.store.finish(run, status);
    } catch {
      await this.options.store.finish(run, 'failed');
    }
  }
}

export function createInspirationWorker(options: WorkerOptions) { return new InspirationWorker(options); }
export const inspirationWorker = createInspirationWorker({
  store: mongoInspirationWorkerStore,
  runResearch: (userId, canContinue) => inspirationService.runScheduled(userId, canContinue),
});

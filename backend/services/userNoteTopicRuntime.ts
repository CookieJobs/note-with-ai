import { logger } from '../utils/logger';
import { createUserNoteTopicWorker, type TopicWorkerDependencies } from './userNoteTopicIndexWorker';
import { MongoTopicStore } from './userNoteTopicIndexService';
import {
  advanceRuntimeCursor,
  getRuntimeCursor,
  getTopicBackfillUsersPage,
  runTopicBackfillPage,
} from './userNoteTopicBackfill';

const USER_PAGE_SIZE = 20;
const DEFAULT_POLL_MS = 1_000;
const BACKFILL_RESCAN_INTERVAL_MS = 60_000;

type RuntimeWorker = { processNext(userId: string): Promise<boolean> };
type RuntimeTimer = ReturnType<typeof setInterval>;

export interface UserNoteTopicRuntimeDependencies {
  worker: RuntimeWorker;
  getCursor: typeof getRuntimeCursor;
  listUsers: typeof getTopicBackfillUsersPage;
  advanceCursor: typeof advanceRuntimeCursor;
  backfillPage: typeof runTopicBackfillPage;
  now: () => Date;
  pollMs: number;
  pageSize: number;
  setTimer: typeof setInterval;
  clearTimer: typeof clearInterval;
}

export function createUserNoteTopicRuntime(
  overrides: Partial<UserNoteTopicRuntimeDependencies> & { worker?: RuntimeWorker } = {},
) {
  const store = new MongoTopicStore();
  const dependencies: UserNoteTopicRuntimeDependencies = {
    worker: createUserNoteTopicWorker(store, overrides as TopicWorkerDependencies),
    getCursor: getRuntimeCursor,
    listUsers: getTopicBackfillUsersPage,
    advanceCursor: advanceRuntimeCursor,
    backfillPage: runTopicBackfillPage,
    now: () => new Date(),
    pollMs: DEFAULT_POLL_MS,
    pageSize: USER_PAGE_SIZE,
    setTimer: setInterval,
    clearTimer: clearInterval,
    ...overrides,
  };
  let timer: RuntimeTimer | null = null;
  let tickPromise: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (tickPromise) return tickPromise;
    tickPromise = (async () => {
      const checkpoint = await dependencies.getCursor();
      const page = await dependencies.listUsers(checkpoint.cursor ? String(checkpoint.cursor) : null, dependencies.pageSize);
      const now = dependencies.now();
      if (page.userIds.length === 0) {
        await dependencies.advanceCursor(checkpoint, null, now);
        return;
      }
      // The worker's process-wide semaphore caps provider calls at two. User leases
      // prevent separate runtime instances from processing the same user together.
      await Promise.allSettled(page.userIds.map(async (userId) => {
        try {
          await dependencies.backfillPage({ userId, limit: 50, rescanIntervalMs: BACKFILL_RESCAN_INTERVAL_MS });
        } catch (error) {
          logger.warn('User note topic backfill page failed', { userId, error: error instanceof Error ? error.message : String(error) });
        }
        try {
          await dependencies.worker.processNext(userId);
        } catch (error) {
          logger.warn('User note topic worker failed', { userId, error: error instanceof Error ? error.message : String(error) });
        }
      }));
      await dependencies.advanceCursor(checkpoint, page.cursor, now);
    })().finally(() => { tickPromise = null; });
    return tickPromise;
  }

  function start(): void {
    if (timer) return;
    timer = dependencies.setTimer(() => {
      void tick().catch((error: unknown) => logger.warn('User note topic runtime tick failed', error));
    }, dependencies.pollMs);
    if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
    void tick().catch((error: unknown) => logger.warn('User note topic runtime startup tick failed', error));
  }

  function stop(): void {
    if (timer) dependencies.clearTimer(timer);
    timer = null;
  }

  return { start, stop, tick };
}

let productionRuntime: ReturnType<typeof createUserNoteTopicRuntime> | null = null;

export function startUserNoteTopicRuntime(): void {
  if (productionRuntime) return;
  productionRuntime = createUserNoteTopicRuntime();
  productionRuntime.start();
}

export function stopUserNoteTopicRuntime(): void {
  productionRuntime?.stop();
  productionRuntime = null;
}

import mongoose from 'mongoose';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../config';
import { inspirationWorker } from '../services/inspirationWorker';
import { logger } from '../utils/logger';

export async function runInspirationWorker(signal: AbortSignal): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  try {
    while (!signal.aborted) {
      try {
        await inspirationWorker.tick(new Date());
      } catch {
        logger.error('inspiration worker cycle failed', { code: 'INSPIRATION_WORKER_CYCLE_FAILED' });
      }
      if (signal.aborted) break;
      try { await delay(config.INSPIRATION_WORKER_POLL_MS, undefined, { signal }); }
      catch (error) { if (!signal.aborted) throw error; }
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  runInspirationWorker(controller.signal).catch(() => {
    logger.error('inspiration worker stopped', { code: 'INSPIRATION_WORKER_FATAL' });
    process.exitCode = 1;
  });
}

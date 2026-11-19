import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { config } from '../config';
import { noteDiscoveryWorker } from '../services/noteDiscoveryWorker';
import logger from '../utils/logger';

export async function runNoteDiscoveryWorker(signal: AbortSignal): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  try {
    while (!signal.aborted) {
      try { await noteDiscoveryWorker.tick(signal); }
      catch { logger.error('Note discovery worker cycle failed', { code: 'DISCOVERY_WORKER_CYCLE_FAILED' }); }
      if (signal.aborted) break;
      try { await delay(5000, undefined, { signal }); }
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
  runNoteDiscoveryWorker(controller.signal).catch(() => {
    logger.error('Note discovery worker stopped', { code: 'DISCOVERY_WORKER_FATAL' });
    process.exitCode = 1;
  });
}

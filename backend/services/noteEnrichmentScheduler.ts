import type { EnrichmentScheduler, EnrichmentTask } from './NoteUpdateOrchestrator';
import { logger } from '../utils/logger';

export class InProcessNoteEnrichmentScheduler implements EnrichmentScheduler {
  private readonly pending = new Set<Promise<void>>();
  private readonly metaAttempts = new Map<string, Promise<void>>();

  constructor(private readonly runTask: (task: EnrichmentTask) => Promise<unknown>) {}

  schedule(task: EnrichmentTask): void {
    const key = `${task.noteId}:${task.userId}:${task.sourceRevision}`;
    const prerequisite = task.artifact === 'recommendations' ? this.metaAttempts.get(key) : undefined;
    let pending: Promise<void>;
    pending = Promise.resolve()
      .then(async () => {
        if (prerequisite) await prerequisite;
        await this.runTask(task);
      })
      .catch((error: unknown) => {
        logger.warn('Note enrichment task failed after persistence', {
          noteId: task.noteId,
          artifact: task.artifact,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.pending.delete(pending);
        if (task.artifact === 'meta' && this.metaAttempts.get(key) === pending) {
          this.metaAttempts.delete(key);
        }
      });
    if (task.artifact === 'meta') this.metaAttempts.set(key, pending);
    this.pending.add(pending);
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}

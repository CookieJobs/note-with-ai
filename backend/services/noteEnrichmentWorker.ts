import type { EnrichmentTask } from './NoteUpdateOrchestrator';
import { Note } from '../models/Note';
import { summarizeNoteMeta, expandNoteConcepts } from './llmService';
import { noteEmbeddingService } from './noteEmbeddingService';
import { updateNoteRecommendations, type RecommendationOptions, type RecommendationResult } from './recommendService';
import { InProcessNoteEnrichmentScheduler } from './noteEnrichmentScheduler';

type EnrichmentWorkerNote = {
  _id: unknown;
  userId: unknown;
  revision: unknown;
  content: unknown;
  contentText?: unknown;
  titleOrigin?: unknown;
  keywordsOrigin?: unknown;
};

type WorkerDependencies = {
  summarizeMeta: (contentText: string, userId?: string) => Promise<{
    summary: string;
    concepts: string[];
    title?: string;
    keywords?: string[];
  } | null>;
  generateEmbedding: (task: EnrichmentTask) => Promise<'saved' | 'stale' | 'failed'>;
  refreshRecommendations: (task: EnrichmentTask) => Promise<'saved' | 'stale' | 'failed' | void>;
  now?: () => Date;
};

export type EnrichmentTaskStatus = 'saved' | 'stale' | 'failed';
type RecommendationResultListener = (result: RecommendationResult) => void;
type ProductionTaskOptions = {
  onRecommendationResult?: RecommendationResultListener;
  recommendationOptions?: Pick<RecommendationOptions, 'recallK' | 'finalK' | 's1Threshold' | 'hardThreshold'>;
};

function noteText(note: EnrichmentWorkerNote): string {
  const richText = typeof note.contentText === 'string' ? note.contentText.trim() : '';
  return richText || (typeof note.content === 'string' ? note.content.trim() : '');
}

function createProductionWorker(options: ProductionTaskOptions = {}): NoteEnrichmentWorker {
  return new NoteEnrichmentWorker({
    summarizeMeta: async (contentText, userId) => {
      const [meta, concepts] = await Promise.all([
        summarizeNoteMeta(contentText, userId),
        expandNoteConcepts(contentText, userId),
      ]);
      if (!meta) return null;
      return {
        summary: meta.summary,
        concepts,
        title: meta.title,
        keywords: meta.keywords,
      };
    },
    generateEmbedding: async (task) => {
      const result = await noteEmbeddingService.generateEmbeddingForRevision(
        task.userId,
        task.noteId,
        task.sourceRevision,
      );
      return result.status;
    },
    refreshRecommendations: async (task) => {
      const result = await updateNoteRecommendations(task.noteId, task.userId, {
        ...options.recommendationOptions,
        writeMode: 'await',
        sourceRevision: task.sourceRevision,
      });
      options.onRecommendationResult?.(result);
      return result.meta.diagnostics?.reason === 'stale_source_revision' ? 'stale' : 'saved';
    },
  });
}

export function createProductionNoteEnrichmentScheduler(): InProcessNoteEnrichmentScheduler {
  const worker = createProductionWorker();
  return new InProcessNoteEnrichmentScheduler((task) => worker.run(task));
}

/**
 * Executes an existing maintenance artifact with the same revision-CAS state
 * writes used by scheduled enrichment. It is intentionally internal service
 * plumbing rather than an HTTP repair endpoint.
 */
export async function runProductionNoteEnrichmentTask(
  task: EnrichmentTask,
  options: ProductionTaskOptions = {},
): Promise<EnrichmentTaskStatus> {
  return createProductionWorker(options).run(task);
}

export class NoteEnrichmentWorker {
  private readonly now: () => Date;

  constructor(private readonly dependencies: WorkerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async run(task: EnrichmentTask): Promise<EnrichmentTaskStatus> {
    const note = await Note.findOne({
      _id: task.noteId,
      userId: task.userId,
      revision: task.sourceRevision,
    }) as unknown as EnrichmentWorkerNote | null;
    if (!note) return 'stale';

    try {
      if (task.artifact === 'meta') {
        const meta = await this.dependencies.summarizeMeta(noteText(note), String(note.userId));
        if (!meta) throw new Error('meta generation returned no result');
        const values: Record<string, unknown> = { summary: meta.summary, concepts: meta.concepts };
        if (note.titleOrigin === 'default' && typeof meta.title === 'string') {
          values.title = meta.title;
        }
        if (note.keywordsOrigin === 'default' && Array.isArray(meta.keywords)) {
          values.keywords = meta.keywords;
        }
        return this.mark(task, 'ready', values);
      }

      if (task.artifact === 'embedding') {
        const result = await this.dependencies.generateEmbedding(task);
        if (result === 'stale') return 'stale';
        if (result === 'failed') throw new Error('embedding generation failed');
        return 'saved';
      }

      const result = await this.dependencies.refreshRecommendations(task);
      if (result === 'stale') return 'stale';
      if (result === 'failed') throw new Error('recommendation refresh failed');
      return this.mark(task, 'ready');
    } catch {
      return this.mark(task, 'failed');
    }
  }

  private async mark(
    task: EnrichmentTask,
    status: 'ready' | 'failed',
    values: Record<string, unknown> = {},
  ): Promise<EnrichmentTaskStatus> {
    const artifactState = {
      status,
      sourceRevision: task.sourceRevision,
      attemptedAt: this.now(),
      ...(status === 'failed' ? { errorCode: `NOTE_ENRICHMENT_${task.artifact.toUpperCase()}_FAILED` } : {}),
    };
    const result = await Note.updateOne(
      { _id: task.noteId, userId: task.userId, revision: task.sourceRevision },
      { $set: { ...values, [`enrichment.${task.artifact}`]: artifactState } },
      { timestamps: false },
    );
    return result.matchedCount > 0 ? (status === 'ready' ? 'saved' : 'failed') : 'stale';
  }
}

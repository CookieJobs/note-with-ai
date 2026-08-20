import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { InProcessNoteEnrichmentScheduler } from '../services/noteEnrichmentScheduler';
import { Note } from '../models/Note';
import { NoteEnrichmentWorker } from '../services/noteEnrichmentWorker';
import type { EnrichmentTask } from '../services/NoteUpdateOrchestrator';

type WorkerNote = {
  _id: string;
  userId: string;
  revision: number;
  content: string;
  contentText: string;
  enrichment: Record<string, unknown>;
};

class MemoryWorkerModel {
  readonly updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options: Record<string, unknown> }> = [];

  constructor(private readonly note: WorkerNote | null) {}

  async findOne(filter: Record<string, unknown>): Promise<WorkerNote | null> {
    if (!this.note) return null;
    return Object.entries(filter).every(([key, value]) => (this.note as Record<string, unknown>)[key] === value)
      ? this.note
      : null;
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>) {
    this.updates.push({ filter, update, options });
    return { matchedCount: 1 };
  }
}

function useMemoryWorkerModel(model: MemoryWorkerModel): void {
  mock.method(Note, 'findOne', ((filter: Record<string, unknown>) => (
    model.findOne(filter)
  )) as unknown as typeof Note.findOne);
  mock.method(Note, 'updateOne', ((
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => model.updateOne(filter, update, options)) as unknown as typeof Note.updateOne);
}

const metaTask: EnrichmentTask = {
  noteId: 'note-1', userId: 'user-1', sourceRevision: 3, artifact: 'meta',
};

describe('Note enrichment worker and scheduler', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('recovers a crashed pending meta artifact to ready through the maintenance worker atomically', async () => {
    const model = new MemoryWorkerModel({
      _id: 'note-1', userId: 'user-1', revision: 3, content: '正文', contentText: '正文',
      enrichment: {
        meta: { status: 'pending', sourceRevision: 3, attemptedAt: new Date('2026-08-18T00:00:00.000Z') },
        embedding: { status: 'ready', sourceRevision: 3 },
        recommendations: { status: 'ready', sourceRevision: 3 },
      },
    });
    useMemoryWorkerModel(model);
    const worker = new NoteEnrichmentWorker({
      summarizeMeta: async () => ({ summary: '摘要', concepts: ['概念'] }),
      generateEmbedding: async () => 'saved',
      refreshRecommendations: async () => undefined,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    });

    await worker.run(metaTask);

    assert.deepEqual(model.updates, [{
      filter: { _id: 'note-1', userId: 'user-1', revision: 3 },
      update: {
        $set: {
          summary: '摘要',
          concepts: ['概念'],
          'enrichment.meta': { status: 'ready', sourceRevision: 3, attemptedAt: new Date('2026-08-18T00:00:00.000Z') },
        },
      },
      options: { timestamps: false },
    }]);
  });

  it('silently drops a stale task without writing a failure state for the newer revision', async () => {
    const model = new MemoryWorkerModel(null);
    useMemoryWorkerModel(model);
    const worker = new NoteEnrichmentWorker({
      summarizeMeta: async () => ({ summary: '摘要', concepts: ['概念'] }),
      generateEmbedding: async () => 'saved',
      refreshRecommendations: async () => undefined,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    });

    await worker.run(metaTask);

    assert.equal(model.updates.length, 0);
  });

  it('fills automatic metadata only while the title and keywords remain module-owned defaults', async () => {
    const model = new MemoryWorkerModel({
      _id: 'note-1', userId: 'user-1', revision: 3, content: '正文', contentText: '正文',
      enrichment: {}, titleOrigin: 'default', keywordsOrigin: 'default',
    } as WorkerNote);
    useMemoryWorkerModel(model);
    const worker = new NoteEnrichmentWorker({
      summarizeMeta: async () => ({ summary: '摘要', concepts: ['概念'], title: '自动标题', keywords: ['自动关键词'] }),
      generateEmbedding: async () => 'saved',
      refreshRecommendations: async () => undefined,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    });

    await worker.run(metaTask);

    const values = model.updates[0].update.$set as Record<string, unknown>;
    assert.equal(values.title, '自动标题');
    assert.deepEqual(values.keywords, ['自动关键词']);
  });

  it('never overwrites user-owned title or keywords during a later meta write', async () => {
    const model = new MemoryWorkerModel({
      _id: 'note-1', userId: 'user-1', revision: 3, content: '正文', contentText: '正文',
      enrichment: {}, titleOrigin: 'user', keywordsOrigin: 'user',
    } as WorkerNote);
    useMemoryWorkerModel(model);
    const worker = new NoteEnrichmentWorker({
      summarizeMeta: async () => ({ summary: '摘要', concepts: ['概念'], title: '错误覆盖', keywords: ['错误覆盖'] }),
      generateEmbedding: async () => 'saved',
      refreshRecommendations: async () => undefined,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    });

    await worker.run(metaTask);

    const values = model.updates[0].update.$set as Record<string, unknown>;
    assert.equal('title' in values, false);
    assert.equal('keywords' in values, false);
  });

  it('marks only the failing artifact failed without propagating an enrichment error to the core write path', async () => {
    const model = new MemoryWorkerModel({
      _id: 'note-1', userId: 'user-1', revision: 3, content: '正文', contentText: '正文', enrichment: {},
    });
    useMemoryWorkerModel(model);
    const worker = new NoteEnrichmentWorker({
      summarizeMeta: async () => { throw new Error('provider unavailable'); },
      generateEmbedding: async () => 'saved',
      refreshRecommendations: async () => undefined,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    });

    await worker.run(metaTask);

    assert.deepEqual(model.updates, [{
      filter: { _id: 'note-1', userId: 'user-1', revision: 3 },
      update: {
        $set: {
          'enrichment.meta': {
            status: 'failed', sourceRevision: 3, attemptedAt: new Date('2026-08-18T00:00:00.000Z'), errorCode: 'NOTE_ENRICHMENT_META_FAILED',
          },
        },
      },
      options: { timestamps: false },
    }]);
  });

  it('marks a user-triggered recommendation refresh ready with the same revision-CAS write rule', async () => {
    const model = new MemoryWorkerModel({
      _id: 'note-1', userId: 'user-1', revision: 3, content: '正文', contentText: '正文', enrichment: {},
    });
    useMemoryWorkerModel(model);
    const worker = new NoteEnrichmentWorker({
      summarizeMeta: async () => ({ summary: '摘要', concepts: [] }),
      generateEmbedding: async () => 'saved',
      refreshRecommendations: async () => 'saved',
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    });

    const status = await worker.run({ ...metaTask, artifact: 'recommendations' });

    assert.equal(status, 'saved');
    assert.deepEqual(model.updates, [{
      filter: { _id: 'note-1', userId: 'user-1', revision: 3 },
      update: {
        $set: {
          'enrichment.recommendations': {
            status: 'ready', sourceRevision: 3, attemptedAt: new Date('2026-08-18T00:00:00.000Z'),
          },
        },
      },
      options: { timestamps: false },
    }]);
  });

  it('drains scheduled work deterministically without timers or leaked handles', async () => {
    const seen: EnrichmentTask[] = [];
    const scheduler = new InProcessNoteEnrichmentScheduler(async (task) => { seen.push(task); });

    scheduler.schedule(metaTask);
    scheduler.schedule({ ...metaTask, artifact: 'embedding' });
    await scheduler.drain();

    assert.deepEqual(seen, [metaTask, { ...metaTask, artifact: 'embedding' }]);
  });

  it('runs recommendations only after the matching revision meta attempt settles', async () => {
    const seen: string[] = [];
    let releaseMeta: (() => void) | undefined;
    const metaGate = new Promise<void>((resolve) => { releaseMeta = resolve; });
    const scheduler = new InProcessNoteEnrichmentScheduler(async (task) => {
      if (task.artifact === 'meta') {
        await metaGate;
        seen.push('meta');
        return;
      }
      seen.push(task.artifact);
    });

    scheduler.schedule(metaTask);
    scheduler.schedule({ ...metaTask, artifact: 'recommendations' });
    await Promise.resolve();

    assert.deepEqual(seen, []);
    releaseMeta?.();
    await scheduler.drain();
    assert.deepEqual(seen, ['meta', 'recommendations']);
  });
});

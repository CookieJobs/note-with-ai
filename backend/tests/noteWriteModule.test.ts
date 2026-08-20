import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Note } from '../models/Note';
import {
  getEnrichmentView,
  NoteUpdateOrchestrator,
  type EnrichmentScheduler,
  type EnrichmentTask,
  NoteWriteError,
} from '../services/NoteUpdateOrchestrator';

const originalStaleMs = process.env.NOTE_ENRICHMENT_STALE_MS;

afterEach(() => {
  mock.restoreAll();
  if (originalStaleMs === undefined) delete process.env.NOTE_ENRICHMENT_STALE_MS;
  else process.env.NOTE_ENRICHMENT_STALE_MS = originalStaleMs;
});

type StoredNote = {
  _id: string;
  userId: string;
  content: string;
  contentText?: string;
  contentJson?: Record<string, unknown> | null;
  title?: string;
  summary?: string;
  concepts?: string[];
  keywords?: string[];
  embedding?: number[];
  embeddingMetadata?: Record<string, unknown> | null;
  recommendCache?: Record<string, unknown> | null;
  revision?: number;
  enrichment?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class InMemoryNotes {
  readonly notes = new Map<string, StoredNote>();
  private nextId = 1;

  seed(note: StoredNote): void {
    this.notes.set(note._id, clone(note));
  }

  async create(input: Omit<StoredNote, '_id' | 'createdAt' | 'updatedAt'>): Promise<StoredNote> {
    const now = new Date('2026-08-18T00:00:00.000Z');
    const note: StoredNote = { ...clone(input), _id: `note-${this.nextId++}`, createdAt: now, updatedAt: now };
    this.notes.set(note._id, clone(note));
    return clone(note);
  }

  async findOne(filter: Record<string, unknown>): Promise<StoredNote | null> {
    const found = [...this.notes.values()].find((note) =>
      Object.entries(filter).every(([key, value]) => (note as Record<string, unknown>)[key] === value),
    );
    return found ? clone(found) : null;
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: { $set: Record<string, unknown>; $inc?: Record<string, number> },
  ): Promise<StoredNote | null> {
    const found = [...this.notes.values()].find((note) =>
      Object.entries(filter).every(([key, value]) => (note as Record<string, unknown>)[key] === value),
    );
    if (!found) return null;

    Object.assign(found, clone(update.$set));
    for (const [key, increment] of Object.entries(update.$inc ?? {})) {
      const current = (found as Record<string, unknown>)[key];
      (found as Record<string, unknown>)[key] = (typeof current === 'number' ? current : 0) + increment;
    }
    found.updatedAt = new Date('2026-08-18T00:01:00.000Z');
    this.notes.set(found._id, clone(found));
    return clone(found);
  }
}

class CollectingScheduler implements EnrichmentScheduler {
  readonly tasks: EnrichmentTask[] = [];

  schedule(task: EnrichmentTask): void {
    this.tasks.push(task);
  }
}

function makeModule() {
  const notes = new InMemoryNotes();
  mock.method(Note, 'create', (async (input: Omit<StoredNote, '_id' | 'createdAt' | 'updatedAt'>) => (
    notes.create(input)
  )) as unknown as typeof Note.create);
  mock.method(Note, 'findOne', ((filter: Record<string, unknown>) => (
    notes.findOne(filter)
  )) as unknown as typeof Note.findOne);
  mock.method(Note, 'findOneAndUpdate', ((
    filter: Record<string, unknown>,
    update: { $set: Record<string, unknown>; $inc?: Record<string, number> },
  ) => notes.findOneAndUpdate(filter, update)) as unknown as typeof Note.findOneAndUpdate);
  const scheduler = new CollectingScheduler();
  return { notes, scheduler, module: new NoteUpdateOrchestrator({ scheduler }) };
}

describe('NoteUpdateOrchestrator public create/update contract', () => {
  it('uses NOTE_ENRICHMENT_STALE_MS and treats the configured boundary as degraded', () => {
    const now = Date.parse('2026-08-18T00:05:00.000Z');
    process.env.NOTE_ENRICHMENT_STALE_MS = '1000';
    mock.method(Date, 'now', () => now);

    const view = getEnrichmentView({
      revision: 3,
      enrichment: {
        meta: { status: 'pending', sourceRevision: 3, attemptedAt: new Date(now - 1000) },
        embedding: { status: 'ready', sourceRevision: 3 },
        recommendations: { status: 'ready', sourceRevision: 3 },
      },
    } as any);

    assert.deepEqual(view, { sourceRevision: 3, status: 'degraded' });
  });

  it('defaults NOTE_ENRICHMENT_STALE_MS to five minutes', () => {
    const now = Date.parse('2026-08-18T00:05:00.000Z');
    delete process.env.NOTE_ENRICHMENT_STALE_MS;
    mock.method(Date, 'now', () => now);

    const base = {
      revision: 3,
      enrichment: {
        embedding: { status: 'ready', sourceRevision: 3 },
        recommendations: { status: 'ready', sourceRevision: 3 },
      },
    };
    assert.equal(getEnrichmentView({
      ...base,
      enrichment: { ...base.enrichment, meta: { status: 'pending', sourceRevision: 3, attemptedAt: new Date(now - 299_999) } },
    } as any).status, 'pending');
    assert.equal(getEnrichmentView({
      ...base,
      enrichment: { ...base.enrichment, meta: { status: 'pending', sourceRevision: 3, attemptedAt: new Date(now - 300_000) } },
    } as any).status, 'degraded');
  });

  it('creates a normalized plain-text note at revision one and schedules each initial artifact once', async () => {
    const { module, notes, scheduler } = makeModule();

    const result = await module.create({
      userId: 'user-1',
      body: { kind: 'plain-text', text: '  第一行\r\n\r\n第二行  ' },
    });

    assert.deepEqual(result.note, {
      _id: 'note-1',
      content: '第一行\n\n第二行',
      contentText: '第一行\n\n第二行',
      contentJson: null,
      title: '第一行',
      summary: '',
      concepts: [],
      keywords: [],
      recommendCache: null,
      revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    });
    assert.deepEqual(result.enrichment, { sourceRevision: 1, status: 'pending' });
    assert.deepEqual(scheduler.tasks.map((task) => task.artifact), ['meta', 'embedding', 'recommendations']);
    assert.ok(scheduler.tasks.every((task) => task.sourceRevision === 1));

    const persistedEnrichment = notes.notes.get('note-1')?.enrichment as Record<string, { attemptedAt?: string }>;
    assert.ok(Object.values(persistedEnrichment).every((artifact) => typeof artifact.attemptedAt === 'string'));
  });

  it('derives rich-text semantic text on the server rather than accepting a caller contentText', async () => {
    const { module } = makeModule();

    const result = await module.create({
      userId: 'user-1',
      body: {
        kind: 'rich-text',
        document: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '权威正文' }] }],
        },
        fallbackMarkdown: '# 展示 Markdown',
      },
    });

    assert.equal(result.note.contentText, '权威正文');
    assert.equal(result.note.content, '# 展示 Markdown');
    assert.deepEqual(result.note.contentJson, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '权威正文' }] }],
    });
  });

  it('uses compare-and-set so two writers with the same revision produce exactly one success', async () => {
    const { module, notes } = makeModule();
    notes.seed({
      _id: 'note-1', userId: 'user-1', content: '原正文', contentText: '原正文', contentJson: null,
      title: '原正文', summary: '', concepts: [], keywords: [], revision: 1,
      enrichment: {}, createdAt: new Date('2026-08-18T00:00:00.000Z'), updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    });

    const writes = await Promise.allSettled([
      module.update({ userId: 'user-1', noteId: 'note-1', expectedRevision: 1, changes: { title: '标题 A' } }),
      module.update({ userId: 'user-1', noteId: 'note-1', expectedRevision: 1, changes: { title: '标题 B' } }),
    ]);

    assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = writes.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected' && rejected.reason instanceof NoteWriteError);
    assert.equal((rejected as PromiseRejectedResult).reason.code, 'NOTE_WRITE_CONFLICT');
    assert.equal(notes.notes.get('note-1')?.revision, 2);
  });

  it('validates the expected revision before accepting a no-op update and returns the current canonical snapshot', async () => {
    const { module, notes, scheduler } = makeModule();
    notes.seed({
      _id: 'note-1', userId: 'user-1', content: '正文', contentText: '正文', contentJson: null,
      title: '标题', summary: '', concepts: [], keywords: [], revision: 2,
      enrichment: {}, createdAt: new Date('2026-08-18T00:00:00.000Z'), updatedAt: new Date('2026-08-18T00:01:00.000Z'),
    });

    await assert.rejects(
      () => module.update({ userId: 'user-1', noteId: 'note-1', expectedRevision: 1, changes: { title: '标题' } }),
      (error: unknown) => {
        assert.ok(error instanceof NoteWriteError);
        assert.equal(error.code, 'NOTE_WRITE_CONFLICT');
        assert.equal(error.current?.note.revision, 2);
        return true;
      },
    );
    assert.equal(notes.notes.get('note-1')?.revision, 2);
    assert.equal(scheduler.tasks.length, 0);
  });

  it('clears an invalidated recommendation cache and only requeues recommendations for a title-only change', async () => {
    const { module, notes, scheduler } = makeModule();
    notes.seed({
      _id: 'note-1', userId: 'user-1', content: '正文', contentText: '正文', contentJson: null,
      title: '标题', summary: '摘要', concepts: ['概念'], keywords: ['关键词'], revision: 1,
      recommendCache: { sourceRevision: 1, candidates: ['note-2'] },
      enrichment: {
        meta: { status: 'ready', sourceRevision: 1 },
        embedding: { status: 'ready', sourceRevision: 1 },
        recommendations: { status: 'ready', sourceRevision: 1 },
      },
      createdAt: new Date('2026-08-18T00:00:00.000Z'), updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    });

    const result = await module.update({
      userId: 'user-1', noteId: 'note-1', expectedRevision: 1, changes: { title: '新标题' },
    });

    assert.equal(result.note.revision, 2);
    assert.equal(result.note.recommendCache, null);
    assert.deepEqual(scheduler.tasks, [{
      noteId: 'note-1', userId: 'user-1', sourceRevision: 2, artifact: 'recommendations',
    }]);
  });

  it('preserves derived artifacts for a JSON-only body change and a keyword-only change', async () => {
    const { module, notes, scheduler } = makeModule();
    notes.seed({
      _id: 'note-1', userId: 'user-1', content: '正文', contentText: '正文',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] },
      title: '标题', summary: '摘要', concepts: ['概念'], keywords: ['旧关键词'], revision: 3,
      recommendCache: { sourceRevision: 3, candidates: ['note-2'] },
      enrichment: {
        meta: { status: 'ready', sourceRevision: 3 },
        embedding: { status: 'ready', sourceRevision: 3 },
        recommendations: { status: 'ready', sourceRevision: 3 },
      },
      createdAt: new Date('2026-08-18T00:00:00.000Z'), updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    });

    const afterStructure = await module.update({
      userId: 'user-1', noteId: 'note-1', expectedRevision: 3,
      changes: {
        body: {
          kind: 'rich-text',
          document: { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: '正文' }] }] },
        },
      },
    });
    const afterKeywords = await module.update({
      userId: 'user-1', noteId: 'note-1', expectedRevision: 4, changes: { keywords: ['新关键词'] },
    });

    assert.equal(afterStructure.note.revision, 4);
    assert.equal(afterKeywords.note.revision, 5);
    assert.equal(afterKeywords.note.recommendCache?.sourceRevision, 5);
    assert.equal(scheduler.tasks.length, 0);
    assert.deepEqual(
      Object.values(notes.notes.get('note-1')?.enrichment as Record<string, { status: string; sourceRevision: number }>),
      [
        { status: 'ready', sourceRevision: 5 },
        { status: 'ready', sourceRevision: 5 },
        { status: 'ready', sourceRevision: 5 },
      ],
    );
  });

  it('maps persistence failures to the stable NOTE_WRITE_FAILED contract', async () => {
    const scheduler = new CollectingScheduler();
    mock.method(Note, 'create', (async () => { throw new Error('database unavailable'); }) as unknown as typeof Note.create);
    const module = new NoteUpdateOrchestrator({ scheduler });

    await assert.rejects(
      () => module.create({ userId: 'user-1', body: { kind: 'plain-text', text: '正文' } }),
      (error: unknown) => {
        assert.ok(error instanceof NoteWriteError);
        assert.equal(error.code, 'NOTE_WRITE_FAILED');
        assert.equal(error.statusCode, 500);
        return true;
      },
    );
    assert.equal(scheduler.tasks.length, 0);
  });
});

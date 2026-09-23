import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { LimitedNoteContext, ResearchDraft, ResearchPlan, ResearchSource } from '../services/inspirationTypes';
import { createInspirationService } from '../services/inspirationService';

const noteFixture = {
  _id: { toString: () => 'note-1' }, revision: 4, title: '知识管理', keywords: ['整理'],
  summary: '如何把记录形成可复用知识', updatedAt: new Date('2026-09-22T00:00:00.000Z'),
  content: '必须永远不读取的笔记正文', contentText: '正文纯文本', contentJson: { type: 'doc' },
};
const source: ResearchSource = {
  sourceId: '1', canonicalUrl: 'https://example.com/article', title: '可信来源',
  publisher: 'example.com', snippet: '来源摘要', retrievedAt: '2026-09-22T00:00:00.000Z',
};
const plan: ResearchPlan = { query: '知识管理的研究方法', topicLabel: '知识管理' };
const draft: ResearchDraft = {
  headline: '让记录更容易复用', brief: '可检验的分类方法能帮助持续整理【1】。',
  whyRelevant: '这可能关联近期的知识整理记录。', nextQuestion: '你想先复用哪类记录？', sourceIds: ['1'],
};

function makeNoteQuery(records: unknown[] = [noteFixture]) {
  const query = {
    sort: (value: unknown) => { assert.deepEqual(value, { updatedAt: -1 }); return query; },
    limit: (value: number) => { assert.equal(value, 5); return query; },
    select: (value: string) => { assert.equal(value, '_id revision title keywords summary updatedAt'); return query; },
    lean: async () => records,
  };
  return query;
}

function installModelDoubles(records: unknown[] = [noteFixture], overrides: {
  existing?: Array<{ canonicalUrl: string }>;
  insertSources?: (values: unknown[]) => Promise<unknown>;
} = {}) {
  const Note = require('../models/Note').Note as typeof import('../models/Note').Note;
  const InspirationItem = require('../models/InspirationItem').default as typeof import('../models/InspirationItem').default;
  const InspirationSource = require('../models/InspirationSource').default as typeof import('../models/InspirationSource').default;
  const created: Array<Record<string, unknown>> = [];
  const registered: unknown[][] = [];
  const deletedItems: unknown[] = [];
  const deletedSources: unknown[] = [];
  const updates: unknown[] = [];

  mock.method(Note, 'find', () => makeNoteQuery(records) as never);
  mock.method(InspirationSource, 'find', (filter: Record<string, unknown>) => {
    const query = { select: () => query, lean: async () => {
      assert.ok(typeof filter.userId === 'string');
      return overrides.existing || [];
    } };
    return query as never;
  });
  mock.method(InspirationItem, 'create', async (value: Record<string, unknown>) => {
    const item = { ...value, _id: `item-${created.length + 1}`, createdAt: new Date('2026-09-22T00:00:01.000Z') };
    created.push(item);
    return item as never;
  });
  mock.method(InspirationSource, 'insertMany', async (values: unknown[]) => {
    registered.push(values);
    return overrides.insertSources ? overrides.insertSources(values) : values as never;
  });
  mock.method(InspirationItem, 'updateOne', async (...args: unknown[]) => { updates.push(args); return { matchedCount: 1, modifiedCount: 1 } as never; });
  mock.method(InspirationItem, 'deleteOne', async (filter: unknown) => { deletedItems.push(filter); return { deletedCount: 1 } as never; });
  mock.method(InspirationSource, 'deleteMany', async (filter: unknown) => { deletedSources.push(filter); return { deletedCount: 1 } as never; });
  return { created, registered, deletedItems, deletedSources, updates, InspirationItem };
}

describe('P15 inspiration service', () => {
  afterEach(() => mock.restoreAll());

  it('reads only five recent metadata fields and creates a cited completed result', async () => {
    const models = installModelDoubles();
    const plannerInputs: LimitedNoteContext[][] = [];
    const service = createInspirationService({
      planner: async (notes) => { plannerInputs.push(notes); return plan; },
      search: async (query) => { assert.equal(query, plan.query); return [source]; },
      synthesizer: async () => draft,
    });

    const result = await service.request('user-1');

    assert.equal(result.status, 'created');
    assert.equal(result.item.brief, draft.brief);
    assert.equal(result.item.sources[0].canonicalUrl, source.canonicalUrl);
    assert.equal(JSON.stringify(plannerInputs).includes('必须永远不读取'), false);
    assert.deepEqual(plannerInputs[0], [{
      noteId: 'note-1', revision: 4, title: '知识管理', keywords: ['整理'], summary: '如何把记录形成可复用知识',
    }]);
    assert.equal(models.created[0].status, 'draft');
    assert.equal(models.registered[0].length, 1);
    const [completedFilter, completedUpdate] = models.updates[0] as [Record<string, unknown>, Record<string, unknown>];
    assert.deepEqual(completedFilter, { _id: 'item-1', userId: 'user-1', status: 'draft' });
    assert.deepEqual(completedUpdate, { $set: { status: 'completed' } });
    assert.equal(models.deletedItems.length, 0);
  });

  it('deletes an incomplete result and its registered sources after a duplicate-source race', async () => {
    const models = installModelDoubles([noteFixture], {
      insertSources: async () => { const error = new Error('duplicate') as Error & { code?: number }; error.code = 11000; throw error; },
    });
    const service = createInspirationService({
      planner: async () => plan,
      search: async () => [source],
      synthesizer: async () => draft,
    });
    const result = await service.request('user-1');

    assert.deepEqual(result, { status: 'no_result' });
    assert.equal(models.deletedItems.length, 1);
    assert.deepEqual(models.deletedSources[0], { inspirationId: 'item-1', userId: 'user-1' });
    assert.equal(models.updates.length, 0);
  });

  it('cleans up the draft if it cannot transition to completed', async () => {
    const models = installModelDoubles();
    mock.method(models.InspirationItem, 'updateOne', async () => ({ matchedCount: 0, modifiedCount: 0 }) as never);
    const service = createInspirationService({
      planner: async () => plan,
      search: async () => [source],
      synthesizer: async () => draft,
    });

    await assert.rejects(service.request('user-1'), /could not be completed/);
    assert.deepEqual(models.deletedSources[0], { inspirationId: 'item-1', userId: 'user-1' });
    assert.equal(models.deletedItems.length, 1);
  });

  it('does not return a source already shown to this user', async () => {
    const models = installModelDoubles([noteFixture], { existing: [{ canonicalUrl: source.canonicalUrl }] });
    const service = createInspirationService({
      planner: async () => plan,
      search: async () => [source],
      synthesizer: async () => { throw new Error('synthesis should not run'); },
    });

    assert.deepEqual(await service.request('user-1'), { status: 'no_result' });
    assert.equal(models.created.length, 0);
  });

  it('blocks a second request by the same user while allowing another user to proceed', async () => {
    installModelDoubles();
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const hold = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const service = createInspirationService({
      planner: async (_notes, userId) => {
        if (userId === 'user-1') { firstStarted?.(); await hold; }
        return plan;
      },
      search: async () => [source],
      synthesizer: async () => draft,
    });

    const firstRequest = service.request('user-1');
    await started;
    await assert.rejects(service.request('user-1'), (error: any) => error.details?.code === 'INSPIRATION_IN_PROGRESS');
    const otherUserRequest = await service.request('user-2');
    assert.equal(otherUserRequest.status, 'created');
    releaseFirst?.();
    assert.equal((await firstRequest).status, 'created');
  });

  it('returns only completed results belonging to the requested user', async () => {
    const InspirationItem = require('../models/InspirationItem').default as typeof import('../models/InspirationItem').default;
    let receivedFilter: unknown;
    const item = {
      _id: 'item-1', userId: 'user-1', status: 'completed', topicLabel: '知识管理',
      headline: '让记录更容易复用', brief: draft.brief, whyRelevant: draft.whyRelevant,
      nextQuestion: draft.nextQuestion, sources: [source], createdAt: new Date('2026-09-22T00:00:01.000Z'),
      relatedNotes: [{ noteId: 'secret-note-id', revision: 4 }], internalQuery: 'secret query',
    };
    const query = {
      sort: (value: unknown) => { assert.deepEqual(value, { createdAt: -1 }); return query; },
      lean: async () => item,
    };
    mock.method(InspirationItem, 'findOne', (filter: unknown) => { receivedFilter = filter; return query as never; });
    const service = createInspirationService();

    const result = await service.latest('user-1');

    assert.deepEqual(receivedFilter, { userId: 'user-1', status: 'completed' });
    assert.equal(result?.headline, '让记录更容易复用');
    assert.equal('userId' in (result as object), false);
    assert.equal('relatedNotes' in (result as object), false);
    assert.equal('internalQuery' in (result as object), false);
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Note } from '../models/Note';
import { getRelatedNoteSummaries } from '../services/relatedNoteSummaryService';
import { AppError } from '../utils/errorHandler';

describe('related note summaries', () => {
  afterEach(() => mock.restoreAll());

  it('returns ranked owned candidate summaries without internal scores', async () => {
    const createdAt = new Date('2026-09-12T00:00:00.000Z');
    const source = {
      _id: 'source-1',
      userId: 'owner-1',
      revision: 4,
      recommendCache: {
        sourceRevision: 4,
        byCandidateId: {
          'candidate-2': { s1: 0.9, s2: 0.8, type: '同一主题', reason: '都在讨论阅读计划' },
          'candidate-1': { s1: 0.8, s2: 0.6, type: '延伸思考', reason: '补充了下一步行动' },
        },
      },
    };
    let candidateFilter: unknown;
    mock.method(Note, 'findOne', () => ({ lean: async () => source }) as never);
    mock.method(Note, 'find', (filter: unknown) => {
      candidateFilter = filter;
      return {
        select() { return this; },
        lean: async () => [
          { _id: 'candidate-1', title: '行动', contentText: '安排本周阅读', createdAt, type: 'note' },
          { _id: 'candidate-2', title: '阅读', contentText: '关于阅读计划', createdAt, type: 'note' },
        ],
      } as never;
    });

    const summaries = await getRelatedNoteSummaries({ userId: 'owner-1', noteId: 'source-1' });

    assert.deepEqual(candidateFilter, { _id: { $in: ['candidate-2', 'candidate-1'] }, userId: 'owner-1' });
    assert.deepEqual(summaries, [
      {
        id: 'candidate-2',
        title: '阅读',
        contentText: '关于阅读计划',
        createdAt: createdAt.toISOString(),
        type: '同一主题',
        reason: '都在讨论阅读计划',
        scoreBand: 'supported',
      },
      {
        id: 'candidate-1',
        title: '行动',
        contentText: '安排本周阅读',
        createdAt: createdAt.toISOString(),
        type: '延伸思考',
        reason: '补充了下一步行动',
        scoreBand: 'possible',
      },
    ]);
    assert.equal(JSON.stringify(summaries).includes('s1'), false);
    assert.equal(JSON.stringify(summaries).includes('s2'), false);
  });

  it('does not disclose a source note owned by someone else', async () => {
    mock.method(Note, 'findOne', () => ({ lean: async () => null }) as never);

    await assert.rejects(
      () => getRelatedNoteSummaries({ userId: 'owner-1', noteId: 'someone-else-note' }),
      (error: unknown) => error instanceof AppError && error.statusCode === 404,
    );
  });

  it('omits deleted and unowned candidates while keeping cached rank and a five-item maximum', async () => {
    const createdAt = new Date('2026-09-12T00:00:00.000Z');
    const byCandidateId = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [`candidate-${index + 1}`, {
        s2: 0.8,
        type: '同一主题',
        reason: `原因 ${index + 1}`,
      }]),
    );
    let candidateFilter: unknown;
    mock.method(Note, 'findOne', () => ({ lean: async () => ({
      revision: 2,
      recommendCache: { sourceRevision: 2, byCandidateId },
    }) }) as never);
    mock.method(Note, 'find', (filter: unknown) => {
      candidateFilter = filter;
      return {
        select() { return this; },
        lean: async () => [
          { _id: 'candidate-7', title: '第七', contentText: '第七条', createdAt },
          { _id: 'candidate-6', title: '第六', contentText: '第六条', createdAt },
          { _id: 'candidate-5', title: '第五', contentText: '第五条', createdAt },
          { _id: 'candidate-4', title: '第四', contentText: '第四条', createdAt },
          { _id: 'candidate-3', title: '第三', contentText: '第三条', createdAt },
          // candidate-1 has been deleted and candidate-2 belongs to another user,
          // so neither is returned by the owner-scoped Mongo query.
        ],
      } as never;
    });

    const summaries = await getRelatedNoteSummaries({ userId: 'owner-1', noteId: 'source-1' });

    assert.deepEqual(candidateFilter, {
      _id: { $in: ['candidate-1', 'candidate-2', 'candidate-3', 'candidate-4', 'candidate-5', 'candidate-6', 'candidate-7'] },
      userId: 'owner-1',
    });
    assert.deepEqual(summaries.map(({ id }) => id), ['candidate-3', 'candidate-4', 'candidate-5', 'candidate-6', 'candidate-7']);
    assert.equal(summaries.length, 5);
  });

  it('keeps the highest final scores from a large cache with a deterministic id tie-break', async () => {
    const byCandidateId = Object.fromEntries([
      ['candidate-z', { s1: 0.5, s2: 0.5, type: '同一主题', reason: 'z' }],
      ['candidate-b', { s1: 0.5, s2: 0.5, type: '同一主题', reason: 'b' }],
      ['candidate-a', { s1: 0.5, s2: 0.5, type: '同一主题', reason: 'a' }],
      ...Array.from({ length: 10000 }, (_, index) => [
        `low-${index}`,
        { s1: 0.1, s2: 0.1, type: '弱关联', reason: 'low' },
      ]),
      ['candidate-high', { s1: 0.9, s2: 0.9, type: '同一主题', reason: 'high' }],
    ]);
    let candidateFilter: unknown;
    mock.method(Note, 'findOne', () => ({ lean: async () => ({
      revision: 2,
      recommendCache: { sourceRevision: 2, byCandidateId },
    }) }) as never);
    mock.method(Note, 'find', (filter: unknown) => {
      candidateFilter = filter;
      return {
        select() { return this; },
        lean: async () => Array.from(
          (filter as { _id: { $in: string[] } })._id.$in,
          (id) => ({ _id: id, title: id, contentText: id, createdAt: new Date('2026-09-12T00:00:00.000Z') }),
        ),
      } as never;
    });

    const summaries = await getRelatedNoteSummaries({ userId: 'owner-1', noteId: 'source-1' });

    const candidateIds = (candidateFilter as { _id: { $in: string[] } })._id.$in;
    assert.equal(candidateIds.length, 20);
    assert.deepEqual(candidateIds.slice(0, 5), ['candidate-high', 'candidate-a', 'candidate-b', 'candidate-z', 'low-0']);
    assert.equal((candidateFilter as { userId: string }).userId, 'owner-1');
    assert.deepEqual(summaries.map(({ id }) => id), ['candidate-high', 'candidate-a', 'candidate-b', 'candidate-z', 'low-0']);
    assert.equal(summaries.length, 5);
    assert.equal(JSON.stringify(summaries).includes('0.9'), false);
  });

  it('returns no summaries from missing or stale recommendation cache', async () => {
    const candidateQueries: unknown[] = [];
    mock.method(Note, 'findOne', () => ({ lean: async () => ({
      revision: 4,
      recommendCache: { sourceRevision: 3, byCandidateId: { 'candidate-1': { s2: 1 } } },
    }) }) as never);
    mock.method(Note, 'find', (filter: unknown) => {
      candidateQueries.push(filter);
      return {} as never;
    });

    const summaries = await getRelatedNoteSummaries({ userId: 'owner-1', noteId: 'source-1' });

    assert.deepEqual(summaries, []);
    assert.deepEqual(candidateQueries, []);
  });

  it('normalizes and bounds every public summary field', async () => {
    mock.method(Note, 'findOne', () => ({ lean: async () => ({
      revision: 1,
      recommendCache: {
        sourceRevision: 1,
        byCandidateId: {
          candidate: { s2: 0.8, type: `  ${'类型'.repeat(50)}\n`, reason: `  ${'原因'.repeat(400)}\t` },
        },
      },
    }) }) as never);
    mock.method(Note, 'find', () => ({
      select() { return this; },
      lean: async () => [{
        _id: 'candidate',
        title: `  ${'标题'.repeat(200)}\n`,
        contentText: `\t${'正文'.repeat(2000)}  `,
        createdAt: new Date('2026-09-12T00:00:00.000Z'),
      }],
    }) as never);

    const [summary] = await getRelatedNoteSummaries({ userId: 'owner-1', noteId: 'source-1' });

    assert.equal(summary.title.length, 200);
    assert.equal(summary.contentText.length, 2000);
    assert.equal(summary.type.length, 80);
    assert.equal(summary.reason.length, 500);
    assert.equal(summary.title.includes('\n'), false);
    assert.equal(summary.contentText.includes('\t'), false);
  });
});

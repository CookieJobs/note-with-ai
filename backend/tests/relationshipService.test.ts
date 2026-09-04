import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.QQ_EMAIL_USER = process.env.QQ_EMAIL_USER || 'test@example.com';
process.env.QQ_EMAIL_PASS = process.env.QQ_EMAIL_PASS || 'test-password';

const source = {
  _id: 'note-a',
  userId: 'user-1',
  revision: 3,
  title: '散步后的想法',
  contentText: '散步时想到，应该给新功能留出观察期。',
  createdAt: new Date('2026-03-01T10:00:00.000Z'),
  updatedAt: new Date('2026-03-01T10:00:00.000Z'),
};

const candidate = {
  _id: 'note-b',
  userId: 'user-1',
  revision: 1,
  title: '上线复盘',
  contentText: '新功能上线后先留出观察期，再决定是否继续投入。',
  createdAt: new Date('2026-02-20T10:00:00.000Z'),
  updatedAt: new Date('2026-02-20T10:00:00.000Z'),
};

describe('relationshipService', () => {
  afterEach(() => mock.restoreAll());

  it('builds a stable relationship with two revision-bound, source-verifiable excerpts', async () => {
    const { buildVerifiedRelationship } = await import('../services/relationshipService');
    const relationship = buildVerifiedRelationship({
      source,
      candidate,
      explanation: {
        kind: 'continuation',
        headline: '两条记录都在等待观察期后的决定',
        explanation: '它们都提到先观察新功能，再决定下一步如何投入。',
        confidence: 'supported',
        sourceExcerpt: '给新功能留出观察期',
        candidateExcerpt: '先留出观察期，再决定是否继续投入',
      },
    });

    assert.ok(relationship);
    assert.equal(relationship.relationshipId, 'relationship:note-a:3:note-b:1');
    assert.deepEqual(relationship.source, {
      noteId: 'note-a',
      revision: 3,
      excerpt: '给新功能留出观察期',
      occurredAt: '2026-03-01T10:00:00.000Z',
    });
    assert.deepEqual(relationship.candidate, {
      noteId: 'note-b',
      revision: 1,
      excerpt: '先留出观察期，再决定是否继续投入',
      occurredAt: '2026-02-20T10:00:00.000Z',
    });
  });

  it('rejects an explanation when either excerpt is not in the exact revision text', async () => {
    const { buildVerifiedRelationship } = await import('../services/relationshipService');
    const relationship = buildVerifiedRelationship({
      source,
      candidate,
      explanation: {
        kind: 'change',
        headline: '看起来发生了变化',
        explanation: '这两条记录展示了一个变化。',
        confidence: 'possible',
        sourceExcerpt: '模型猜测的句子',
        candidateExcerpt: '先留出观察期，再决定是否继续投入',
      },
    });

    assert.equal(relationship, null);
  });

  it('normalizes note pair order so A-B and B-A address the same hidden pair', async () => {
    const { normalizePair } = await import('../services/relationshipService');
    assert.deepEqual(normalizePair('note-z', 'note-a'), ['note-a', 'note-z']);
    assert.deepEqual(normalizePair('note-a', 'note-z'), ['note-a', 'note-z']);
  });

  it('does not return hidden pairs when filtering relationships', async () => {
    const { RelationshipFeedback } = await import('../models/RelationshipFeedback');
    const { filterVisibleRelationships } = await import('../services/relationshipService');
    mock.method(RelationshipFeedback, 'find', () => ({ lean: async () => [{ noteIds: ['note-a', 'note-b'], verdict: 'hide_pair' }] }) as never);

    const relationships = [
      { relationshipId: 'relationship:note-a:3:note-b:1', source: { noteId: 'note-a' }, candidate: { noteId: 'note-b' } },
      { relationshipId: 'relationship:note-a:3:note-c:1', source: { noteId: 'note-a' }, candidate: { noteId: 'note-c' } },
    ];

    const visible = await filterVisibleRelationships('user-1', relationships as never);
    assert.deepEqual(visible.map((item) => item.relationshipId), ['relationship:note-a:3:note-c:1']);
  });

  it('filters not-relevant feedback by relationship id without hiding a newer relationship for the same pair', async () => {
    const { RelationshipFeedback } = await import('../models/RelationshipFeedback');
    const { filterVisibleRelationships } = await import('../services/relationshipService');
    mock.method(RelationshipFeedback, 'find', () => ({ lean: async () => [{
      relationshipId: 'relationship:note-a:3:note-b:1',
      noteIds: ['note-a', 'note-b'],
      verdict: 'not_relevant',
    }] }) as never);

    const relationships = [
      { relationshipId: 'relationship:note-a:3:note-b:1', source: { noteId: 'note-a' }, candidate: { noteId: 'note-b' } },
      { relationshipId: 'relationship:note-a:4:note-b:1', source: { noteId: 'note-a' }, candidate: { noteId: 'note-b' } },
    ];

    const visible = await filterVisibleRelationships('user-1', relationships as never);
    assert.deepEqual(visible.map((item) => item.relationshipId), ['relationship:note-a:4:note-b:1']);
  });

  it('rejects feedback when the relationship id does not match the authorized notes and revisions', async () => {
    const { Note } = await import('../models/Note');
    const { submitRelationshipFeedback } = await import('../services/relationshipService');
    mock.method(Note, 'findOne', (filter: Record<string, unknown>) => ({
      select: async () => filter._id === 'note-a' ? { _id: 'note-a', revision: 3 } : { _id: 'note-b', revision: 1 },
    }) as never);

    await assert.rejects(
      submitRelationshipFeedback({
        userId: 'user-1',
        relationshipId: 'relationship:note-a:2:note-b:1',
        sourceNoteId: 'note-a',
        candidateNoteId: 'note-b',
        sourceRevision: 3,
        candidateRevision: 1,
        verdict: 'helpful',
      }),
      /关系已更新|关系不存在/
    );
  });

  it('rejects feedback for a deleted or foreign candidate note', async () => {
    const { Note } = await import('../models/Note');
    const { submitRelationshipFeedback } = await import('../services/relationshipService');
    mock.method(Note, 'findOne', (filter: Record<string, unknown>) => ({
      select: async () => filter._id === 'note-a' ? { _id: 'note-a', revision: 3 } : null,
    }) as never);

    await assert.rejects(
      submitRelationshipFeedback({
        userId: 'user-1', relationshipId: 'relationship:note-a:3:note-b:1', sourceNoteId: 'note-a', candidateNoteId: 'note-b',
        sourceRevision: 3, candidateRevision: 1, verdict: 'helpful',
      }),
      /关系不存在或无权限/
    );
  });

  it('rejects feedback when either authorized note has a newer revision', async () => {
    const { Note } = await import('../models/Note');
    const { submitRelationshipFeedback } = await import('../services/relationshipService');
    mock.method(Note, 'findOne', (filter: Record<string, unknown>) => ({
      select: async () => ({ _id: filter._id, revision: filter._id === 'note-a' ? 4 : 1 }),
    }) as never);

    await assert.rejects(
      submitRelationshipFeedback({
        userId: 'user-1', relationshipId: 'relationship:note-a:3:note-b:1', sourceNoteId: 'note-a', candidateNoteId: 'note-b',
        sourceRevision: 3, candidateRevision: 1, verdict: 'helpful',
      }),
      /关系已更新/
    );
  });

  it('fails closed when relationship explanation generation is unavailable', async () => {
    const { generateRelationshipExplanation } = await import('../services/relationshipService');

    const explanation = await generateRelationshipExplanation({ source, candidate });
    assert.equal(explanation, null);
  });

  it('does not return relationship context for another account', async () => {
    const { Note } = await import('../models/Note');
    const { findRelationshipContext } = await import('../services/relationshipService');
    let query: unknown;
    mock.method(Note, 'find', (filter: unknown) => {
      query = filter;
      return { select: () => ({ lean: async () => [] }) } as never;
    });

    const context = await findRelationshipContext('user-2', 'relationship:note-a:3:note-b:1');
    assert.equal(context, null);
    assert.deepEqual(query, { userId: 'user-2' });
  });

  it('does not return relationship context when a note was deleted or revised', async () => {
    const { Note } = await import('../models/Note');
    const { findRelationshipContext } = await import('../services/relationshipService');
    const relation = {
      relationshipId: 'relationship:note-a:3:note-b:1',
      source: { noteId: 'note-a', revision: 3, excerpt: '正文', occurredAt: '2026-03-01T00:00:00.000Z' },
      candidate: { noteId: 'note-b', revision: 1, excerpt: '过去的正文', occurredAt: '2026-02-20T00:00:00.000Z' },
      kind: 'continuation', headline: '关系', explanation: '两条记录有联系。', confidence: 'supported', generatedAt: '2026-03-02T00:00:00.000Z',
    };
    mock.method(Note, 'find', () => ({
      select: () => ({ lean: async () => [{ _id: 'note-a', userId: 'user-1', revision: 4, contentText: '正文', recommendCache: { byCandidateId: { 'note-b': { relationship: relation } } } }] }),
    }) as never);

    const context = await findRelationshipContext('user-1', relation.relationshipId);
    assert.equal(context, null);
  });

  it('upserts repeated feedback for the same account and relationship', async () => {
    const { Note } = await import('../models/Note');
    const { RelationshipFeedback } = await import('../models/RelationshipFeedback');
    const { submitRelationshipFeedback } = await import('../services/relationshipService');
    mock.method(Note, 'findOne', (filter: Record<string, unknown>) => ({
      select: async () => ({ _id: filter._id, revision: filter._id === 'note-a' ? 3 : 1 }),
    }) as never);
    const updates: unknown[] = [];
    mock.method(RelationshipFeedback, 'findOneAndUpdate', (filter: unknown, update: unknown) => {
      updates.push({ filter, update });
      return { lean: async () => ({ verdict: (update as { $set: { verdict: string } }).$set.verdict }) } as never;
    });

    await submitRelationshipFeedback({
      userId: 'user-1', relationshipId: 'relationship:note-a:3:note-b:1', sourceNoteId: 'note-a', candidateNoteId: 'note-b',
      sourceRevision: 3, candidateRevision: 1, verdict: 'helpful',
    });
    const result = await submitRelationshipFeedback({
      userId: 'user-1', relationshipId: 'relationship:note-a:3:note-b:1', sourceNoteId: 'note-a', candidateNoteId: 'note-b',
      sourceRevision: 3, candidateRevision: 1, verdict: 'not_relevant',
    });

    assert.equal((result as { verdict?: string } | null)?.verdict, 'not_relevant');
    assert.equal(updates.length, 2);
    assert.deepEqual((updates[1] as { filter: unknown }).filter, { userId: 'user-1', relationshipId: 'relationship:note-a:3:note-b:1' });
  });
});

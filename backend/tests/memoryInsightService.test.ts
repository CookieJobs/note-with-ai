import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import MemoryInsight from '../models/MemoryInsight';
import MemorySuppression from '../models/MemorySuppression';
import NoteAiPreference from '../models/NoteAiPreference';
import { Note } from '../models/Note';
import { memoryInsightService } from '../services/memoryInsightService';

describe('memory insight governance', () => {
  afterEach(() => mock.restoreAll());

  it('keeps corrected wording authoritative and creates a minimum suppression', async () => {
    mock.method(MemoryInsight, 'findOne', async () => ({ _id: 'memory-a', userId: 'owner-a', fingerprint: 'f'.repeat(64), statement: '旧表述' }) as never);
    const updates: unknown[][] = [];
    mock.method(MemoryInsight, 'findOneAndUpdate', async (...args: unknown[]) => {
      updates.push(args);
      return { _id: 'memory-a', statement: '旧表述', userCorrection: '更准确的表述', status: 'corrected', fingerprint: 'f'.repeat(64), evidence: [] } as never;
    });
    const suppressions: unknown[][] = [];
    mock.method(MemorySuppression, 'updateOne', async (...args: unknown[]) => { suppressions.push(args); return {} as never; });

    const result = await memoryInsightService.correct('owner-a', 'memory-a', '更准确的表述');

    assert.equal(result.displayStatement, '更准确的表述');
    assert.deepEqual((updates[0] as any)[0], { _id: 'memory-a', userId: 'owner-a' });
    assert.deepEqual((suppressions[0] as any)[0], { userId: 'owner-a', fingerprint: 'f'.repeat(64) });
  });

  it('rejects note preference changes for a note outside the user scope', async () => {
    mock.method(Note, 'findOne', async () => null as never);
    await assert.rejects(() => memoryInsightService.setNotePreference('owner-a', 'note-b', false), /不存在|无权限/);
  });

  it('defaults an owned note to included when no preference is persisted', async () => {
    mock.method(Note, 'findOne', async () => ({ _id: 'note-a' }) as never);
    mock.method(NoteAiPreference, 'findOne', () => ({ lean: async () => null }) as never);
    assert.deepEqual(await memoryInsightService.getNotePreference('owner-a', 'note-a'), { noteId: 'note-a', included: true });
  });

  it('creates a proposed, evidenced goal only from an allowed non-sensitive note', async () => {
    mock.method(NoteAiPreference, 'find', () => ({ select: () => ({ lean: async () => [] }) }) as never);
    mock.method(Note, 'find', () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ _id: 'note-a', revision: 2, contentText: '我想持续练习写作。', updatedAt: new Date('2026-09-01') }] }) }) }) as never);
    mock.method(MemorySuppression, 'exists', async () => null as never);
    mock.method(MemoryInsight, 'findOne', async () => null as never);
    const created: any[] = [];
    mock.method(MemoryInsight, 'create', async (value: any) => { created.push(value); return { _id: 'memory-a', ...value } as never; });

    const result = await memoryInsightService.generateProposals('owner-a');

    assert.equal(result.created, 1);
    assert.equal(created[0].kind, 'stated_goal');
    assert.equal(created[0].evidence[0].excerpt, '我想持续练习写作');
  });
});

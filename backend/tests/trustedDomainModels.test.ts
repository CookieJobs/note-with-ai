import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import MemoryInsight from '../models/MemoryInsight';
import MemorySuppression from '../models/MemorySuppression';
import NoteAiPreference from '../models/NoteAiPreference';
import PublishedNote from '../models/PublishedNote';
import InspirationItem from '../models/InspirationItem';
import InspirationSettings from '../models/InspirationSettings';
import InspirationJob from '../models/InspirationJob';

describe('trusted feature persistence models', () => {
  it('defines owner-isolation and lifecycle indexes', () => {
    const hasIndex = (model: any, expected: Record<string, number>, options: Record<string, unknown> = {}) =>
      model.schema.indexes().some(([keys, found]: [Record<string, number>, Record<string, unknown>]) =>
        Object.entries(expected).every(([key, value]) => keys[key] === value)
        && Object.entries(options).every(([key, value]) => found[key] === value));
    assert.equal(hasIndex(MemoryInsight, { userId: 1, status: 1 }), true);
    assert.equal(hasIndex(MemorySuppression, { userId: 1, fingerprint: 1 }, { unique: true }), true);
    assert.equal(hasIndex(NoteAiPreference, { userId: 1, noteId: 1 }, { unique: true }), true);
    assert.equal(hasIndex(PublishedNote, { slug: 1 }, { unique: true }), true);
    assert.equal(hasIndex(InspirationItem, { userId: 1, 'source.canonicalUrl': 1 }), true);
    assert.equal(hasIndex(InspirationSettings, { userId: 1 }, { unique: true }), true);
    assert.equal(hasIndex(InspirationJob, { userId: 1, status: 1 }), true);
  });

  it('limits memory kinds and published state at the schema boundary', () => {
    const memory = new MemoryInsight({
      userId: '507f1f77bcf86cd799439011', kind: 'medical_diagnosis',
      statement: '不允许', evidence: [], fingerprint: 'f'.repeat(64),
    });
    const publication = new PublishedNote({
      ownerUserId: '507f1f77bcf86cd799439011', sourceNoteId: '507f1f77bcf86cd799439012',
      sourceRevision: 1, slug: 'safe-slug', contentSnapshot: { type: 'doc', content: [] }, status: 'deleted',
    });
    assert.ok(memory.validateSync());
    assert.ok(publication.validateSync());
  });
});


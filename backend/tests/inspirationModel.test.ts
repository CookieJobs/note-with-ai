import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import InspirationItem from '../models/InspirationItem';
import { toInspirationDto } from '../services/inspirationTypes';

describe('inspiration model compatibility', () => {
  it('shows an old P15 result as regular manual history without leaking internal fields', () => {
    const dto = toInspirationDto({
      _id: '507f191e810c19729de860ea',
      status: 'completed',
      createdAt: new Date('2026-09-22T00:00:00Z'),
      topicLabel: '知识管理', headline: '整理想法', brief: '可靠来源【1】',
      whyRelevant: '关联笔记', nextQuestion: '下一步？', sources: [],
      relatedNotes: [{ noteId: 'private-note' }], internalQuery: 'private query',
    });
    assert.equal(dto.userState, 'regular');
    assert.equal(dto.origin, 'manual');
    assert.equal(dto.viewedAt, null);
    assert.equal('relatedNotes' in dto, false);
    assert.equal('internalQuery' in dto, false);
  });

  it('keeps generation status independent of user organization', () => {
    const doc = new InspirationItem({ status: 'completed', userState: 'saved', origin: 'scheduled' });
    assert.equal(doc.status, 'completed');
    assert.equal(doc.userState, 'saved');
    assert.equal(doc.origin, 'scheduled');
  });
});

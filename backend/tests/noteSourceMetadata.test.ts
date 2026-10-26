import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sourceMetadata } from '../services/noteSourceMetadata';

describe('note source metadata', () => {
  it('bounds original content and carries actual image/date metadata', () => {
    const source = sourceMetadata({
      contentText: `[图片]\n${'😀'.repeat(601)}`,
      contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: '/first' } }, { type: 'image', attrs: { src: '/second' } }] },
      createdAt: new Date('2026-10-12T16:30:00.000Z'),
    });
    assert.equal(Array.from(source.excerpt).length, 600);
    assert.equal(source.sourceType, 'mixed');
    assert.equal(source.imageCount, 2);
    assert.equal(source.firstImageSrc, '/first');
    assert.equal(source.createdAt?.toISOString(), '2026-10-12T16:30:00.000Z');
  });

  it('does not call an empty abnormal record an image note', () => {
    assert.equal(sourceMetadata({ contentText: '' }).sourceType, 'text');
    assert.equal(sourceMetadata({ contentText: '[图片]', contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: '/first' } }] } }).sourceType, 'image');
  });
});

import { describe, expect, it } from 'vitest';
import { noteReferenceDisplay } from './noteReference';

describe('note reference display', () => {
  it('uses the first original line and bounds it by Unicode code points', () => {
    const display = noteReferenceDisplay({ title: '  ', excerpt: `  ${'😀'.repeat(49)}  \n 第二行  原文 ` });
    expect(display.label).toBe(`${'😀'.repeat(48)}…`);
    expect(display.secondary).toBe('第二行 原文');
  });

  it('never promotes a summary into a source label', () => {
    expect(noteReferenceDisplay({ title: '', createdAt: '2026-10-12T16:30:00.000Z' }).label).toBe('笔记 · 2026/10/13 00:30');
    expect(noteReferenceDisplay({ title: '' }).label).toBe('查看原笔记');
    expect(noteReferenceDisplay({ contentText: '[图片]' }).label).toBe('查看原笔记');
  });

  it('recognizes image-only placeholders and real source time', () => {
    const display = noteReferenceDisplay({ title: '', contentText: '[图片]', sourceType: 'image', imageCount: 2, firstImageSrc: '/image/1', createdAt: '2026-10-12T16:30:00.000Z' });
    expect(display.label).toBe('图片笔记 · 2 张');
    expect(display.dateLabel).toBe('2026/10/13 00:30');
    expect(display.firstImageSrc).toBe('/image/1');
    expect(noteReferenceDisplay({ contentText: '[图片]', contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: '/local' } }] } }).firstImageSrc).toBe('/local');
  });

  it('ignores invalid and synthetic legacy care dates', () => {
    expect(noteReferenceDisplay({ createdAt: 'invalid' }).dateLabel).toBeNull();
    expect(noteReferenceDisplay({ matchType: 'care_source', createdAt: '2026-10-12T16:30:00.000Z' }).dateLabel).toBeNull();
    expect(noteReferenceDisplay({ matchType: 'care_source', createdAtSource: 'note', createdAt: '2026-10-12T16:30:00.000Z' }).label).toBe('笔记 · 2026/10/13 00:30');
  });
});

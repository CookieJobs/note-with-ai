import { describe, expect, it } from 'vitest';
import { noteFeedText, placeNoteCards, beijingDate, monthGrid } from './noteFeed';
describe('note feed display', () => {
  it('extracts only read-only display text from historical markup and preserves line breaks', () => {
    expect(noteFeedText({ content: '# 标题\n\n**想法**与[链接](https://example.com)\n![图片](https://example.com/a.png)' })).toBe('标题\n\n想法与链接');
    expect(noteFeedText({ contentText: '今天\n明天', content: 'old' })).toBe('今天\n明天');
    expect(noteFeedText({ content: '<script>alert(1)</script><p>正文</p>' })).not.toContain('<script>');
  });
  it('preserves plain-text punctuation rather than treating stored plain text as Markdown', () => {
    expect(noteFeedText({ contentText: 'a_b * c < 5，**原样文字**', content: 'a_b * c < 5，**原样文字**' })).toBe('a_b * c < 5，**原样文字**');
  });
  it('places cards by shortest column in data order', () => {
    expect(placeNoteCards([100, 50, 80, 60], 2, 300, 20)).toEqual({
      positions: [{ left: 0, top: 0 }, { left: 320, top: 0 }, { left: 320, top: 70 }, { left: 0, top: 120 }], height: 180,
    });
  });
  it('uses Beijing day boundaries and Monday-first leap-month grids', () => {
    expect(beijingDate(new Date('2026-11-07T16:01:00Z'))).toBe('2026-11-08');
    const cells = monthGrid('2024-02'); expect(cells.slice(0, 4)).toEqual([null, null, null, '2024-02-01']);
    expect(cells.filter(Boolean)).toHaveLength(29); expect(cells.at(-1)).toBe('2024-02-29');
  });
});

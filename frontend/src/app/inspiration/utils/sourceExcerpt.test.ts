import { describe, expect, it } from 'vitest';
import { getSourceExcerptPreview } from './sourceExcerpt';

describe('source excerpt preview', () => {
  it('keeps nonempty image-only Markdown available for disclosure', () => {
    expect(getSourceExcerptPreview('![](https://example.com/full-image.jpg)')).toEqual({ text: '', expandable: true });
  });
  it('leaves short plain text without unnecessary expansion', () => {
    expect(getSourceExcerptPreview('来源摘要')).toEqual({
      text: '来源摘要',
      expandable: false,
    });
  });

  it('cleans common Markdown while preserving its readable text', () => {
    expect(
      getSourceExcerptPreview(
        '# 标题\n**重点** 与 [原文](https://example.com)\n`code`',
      ),
    ).toEqual({ text: '标题 重点 与 原文 code', expandable: true });
  });

  it('limits the default preview to 220 Unicode code points', () => {
    expect(getSourceExcerptPreview('🌱'.repeat(221))).toEqual({
      text: '🌱'.repeat(220) + '…',
      expandable: true,
    });
  });

  it('removes italic and fenced-code presentation without removing their words', () => {
    expect(
      getSourceExcerptPreview('*斜体* 和 _强调_\n```ts\nconst count = 1;\n```')
        .text,
    ).toBe('斜体 和 强调 const count = 1;');
  });

  it('keeps HTML as literal text and returns no text for a blank excerpt', () => {
    const html = '<img src=x onerror="alert(1)">';
    expect(getSourceExcerptPreview(html).text).toBe(html);
    expect(getSourceExcerptPreview(' \n ')).toEqual({
      text: '',
      expandable: false,
    });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NoteBodyValidationError,
  normalizePlainText,
  extractPlainTextFromRichText,
} from '../services/noteContentNormalizer';

describe('noteContentNormalizer', () => {
  it('normalizes line endings, excess blank lines, and outer whitespace for plain text', () => {
    assert.equal(normalizePlainText('  第一行\r\n\r\n\r\n第二行\r第三行  '), '第一行\n\n第二行\n第三行');
  });

  it('extracts readable semantic text from rich-text blocks, hard breaks, code, lists, and images', () => {
    const result = extractPlainTextFromRichText({
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: '标题' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '第一段' },
            { type: 'hardBreak' },
            { type: 'text', text: '续行' },
          ],
        },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表项' }] }] }],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const n = 1;' }] },
        { type: 'image', attrs: { src: 'https://example.test/image.png' } },
      ],
    });

    assert.equal(result, '标题\n第一段\n续行\n列表项\nconst n = 1;\n[图片]');
  });

  it('rejects malformed rich-text documents rather than accepting caller-supplied semantic text', () => {
    assert.throws(
      () => extractPlainTextFromRichText({ type: 'paragraph', content: [] }),
      (error: unknown) => error instanceof NoteBodyValidationError && error.code === 'NOTE_BODY_INVALID',
    );
  });

  it('rejects a rich-text document whose normalized text is blank', () => {
    assert.throws(
      () => extractPlainTextFromRichText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' \r\n ' }] }] }),
      (error: unknown) => error instanceof NoteBodyValidationError && error.code === 'NOTE_BODY_EMPTY',
    );
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeNoteSnapshot } from '../services/publicSnapshot';

describe('public snapshot sanitization', () => {
  it('keeps allowed ProseMirror text but drops unsafe nodes, marks, and image URLs', () => {
    const snapshot = sanitizeNoteSnapshot({
      title: '公开标题',
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '安全文本', marks: [{ type: 'bold' }] },
              { type: 'text', text: '危险链接', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            ],
          },
          { type: 'image', attrs: { src: 'data:text/html,unsafe' } },
          { type: 'html', attrs: { onclick: 'steal()' } },
        ],
      },
      contentText: '回退文本',
    });

    assert.deepEqual(snapshot, {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '安全文本', marks: [{ type: 'bold' }] },
          { type: 'text', text: '危险链接' },
        ],
      }],
    });
  });

  it('falls back to a plain text document when the rich-text value is missing', () => {
    assert.deepEqual(sanitizeNoteSnapshot({ contentText: '第一行\n第二行' }), {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '第一行' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '第二行' }] },
      ],
    });
  });
});


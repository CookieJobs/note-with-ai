import { describe, expect, it } from 'vitest';
import { loadRichTextEditor, preloadRichTextEditor } from './richTextEditorLoader';

describe('richTextEditorLoader', () => {
  it('starts no import until an edit-intent caller invokes the loader and then reuses that import', async () => {
    const first = loadRichTextEditor();
    preloadRichTextEditor();
    const second = loadRichTextEditor();
    expect(second).toBe(first);
    await expect(first).resolves.toHaveProperty('default');
  });
});

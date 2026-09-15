'use client';

let richTextEditorModulePromise: Promise<typeof import('./RichTextEditor')> | null = null;

export function loadRichTextEditor() {
  if (!richTextEditorModulePromise) {
    richTextEditorModulePromise = import('./RichTextEditor');
  }

  return richTextEditorModulePromise;
}

export function preloadRichTextEditor() {
  void loadRichTextEditor();
}

/**
 * Starts the editor chunk only after a person signals that they may write.
 * `loadRichTextEditor` owns the shared promise, so repeated hover, focus, and
 * activation signals all join the same import rather than starting new work.
 */
export function preloadRichTextEditorFromIntent() {
  return loadRichTextEditor();
}

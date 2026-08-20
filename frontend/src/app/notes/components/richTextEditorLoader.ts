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

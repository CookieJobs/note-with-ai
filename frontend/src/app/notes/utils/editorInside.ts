export const NOTE_EDITOR_INSIDE_ATTR = 'data-note-editor-inside';
export const NOTE_EDITOR_INSIDE_VALUE = 'true';
export const NOTE_EDITOR_INSIDE_SELECTOR = `[${NOTE_EDITOR_INSIDE_ATTR}="${NOTE_EDITOR_INSIDE_VALUE}"]`;

export function markNoteEditorInside(element: HTMLElement | null) {
  if (!element) return;
  element.setAttribute(NOTE_EDITOR_INSIDE_ATTR, NOTE_EDITOR_INSIDE_VALUE);
}

export function unmarkNoteEditorInside(element: HTMLElement | null) {
  if (!element) return;
  if (element.getAttribute(NOTE_EDITOR_INSIDE_ATTR) !== NOTE_EDITOR_INSIDE_VALUE) return;
  element.removeAttribute(NOTE_EDITOR_INSIDE_ATTR);
}

import type { JSONContent } from '@tiptap/react';

export function hasTitleSourceText(document: JSONContent | null | undefined, plainText: string): boolean {
  if (!document) return Boolean(plainText.trim());
  if (document.type === 'text' && document.text?.trim()) return true;
  // Image URLs and alt attributes are not the author's naming text.
  return (document.content ?? []).some((node) => hasTitleSourceText(node, ''));
}

export function validateNoteTitle(title: string): string | null {
  if (/[\r\n\u2028\u2029]/u.test(title)) return '标题只能占一行。';
  if (Array.from(title.trim()).length > 100) return '标题不能超过 100 个字符。';
  return null;
}

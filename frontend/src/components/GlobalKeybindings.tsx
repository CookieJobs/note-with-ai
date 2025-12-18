'use client';

import { useEffect } from 'react';

export default function GlobalKeybindings() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key?.toLowerCase();
      if (key !== 'a') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      const isInput = tag === 'input';
      const isTextarea = tag === 'textarea';
      const isEditable = isInput || isTextarea || target.isContentEditable;
      if (!isEditable) return;
      if (isInput || isTextarea) {
        const t = target as HTMLInputElement | HTMLTextAreaElement;
        t.select();
      } else {
        const selection = window.getSelection();
        if (!selection) return;
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.addRange(range);
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler, { capture: true } as any);
    };
  }, []);
  return null;
}


/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
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


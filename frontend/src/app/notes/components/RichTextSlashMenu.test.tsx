import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import type { Editor } from '@tiptap/react';
import { describe, expect, it } from 'vitest';
import { RichTextSlashMenu } from './RichTextSlashMenu';

function createSlashMenuEditor() {
  let onTransaction: (() => void) | undefined;

  const editor = {
    state: {
      selection: {
        from: 1,
        empty: true,
        $from: {
          parent: { type: { name: 'paragraph' }, textContent: '/' },
          parentOffset: 1,
        },
      },
    },
    view: { coordsAtPos: () => ({ top: 0, bottom: 24, left: 16 }) },
    on: (_event: 'transaction', callback: () => void) => { onTransaction = callback; },
    off: () => { onTransaction = undefined; },
  } as unknown as Editor;

  return { editor, openSlashMenu: () => onTransaction?.() };
}

describe('RichTextSlashMenu image entry', () => {
  it('opens its controlled URL dialog after the image button mousedown followed by click', async () => {
    const { editor, openSlashMenu } = createSlashMenuEditor();
    render(<RichTextSlashMenu editor={editor} />);

    await act(async () => { openSlashMenu(); });
    const imageButton = screen.getByRole('button', { name: /image/i });
    fireEvent.mouseDown(imageButton);
    fireEvent.click(imageButton);

    expect(await screen.findByRole('dialog', { name: 'Enter URL' })).toBeInTheDocument();
  });
});

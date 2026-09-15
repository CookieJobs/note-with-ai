import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextSlashMenu } from './RichTextSlashMenu';

function createSlashMenuEditor() {
  let onTransaction: (() => void) | undefined;
  const insertImage = vi.fn();

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
    chain: () => ({
      focus: () => ({
        deleteRange: () => ({
          insertContent: (content: unknown) => {
            insertImage(content);
            return { run: () => undefined };
          },
        }),
      }),
    }),
  } as unknown as Editor;

  return { editor, insertImage, openSlashMenu: () => onTransaction?.() };
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

  it('keeps the URL dialog open when its input receives a pointer event', async () => {
    const { editor, openSlashMenu } = createSlashMenuEditor();
    render(<RichTextSlashMenu editor={editor} />);

    await act(async () => { openSlashMenu(); });
    const imageButton = screen.getByRole('button', { name: /image/i });
    fireEvent.mouseDown(imageButton);
    fireEvent.click(imageButton);
    const input = await screen.findByRole('textbox', { name: 'URL' });

    fireEvent.pointerDown(input);

    expect(screen.getByRole('dialog', { name: 'Enter URL' })).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('lets Enter submit an image URL without the slash-menu shortcut preventing it', async () => {
    const { editor, insertImage, openSlashMenu } = createSlashMenuEditor();
    render(<RichTextSlashMenu editor={editor} />);

    await act(async () => { openSlashMenu(); });
    const imageButton = screen.getByRole('button', { name: /image/i });
    fireEvent.mouseDown(imageButton);
    fireEvent.click(imageButton);
    const input = await screen.findByRole('textbox', { name: 'URL' });
    fireEvent.change(input, { target: { value: 'https://example.com/enter.png' } });

    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    fireEvent.submit(input.closest('form')!);

    expect(insertImage).toHaveBeenCalledWith({ type: 'image', attrs: { src: 'https://example.com/enter.png' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('inserts an image when the dialog Confirm button is clicked', async () => {
    const { editor, insertImage, openSlashMenu } = createSlashMenuEditor();
    render(<RichTextSlashMenu editor={editor} />);

    await act(async () => { openSlashMenu(); });
    const imageButton = screen.getByRole('button', { name: /image/i });
    fireEvent.mouseDown(imageButton);
    fireEvent.click(imageButton);
    fireEvent.change(await screen.findByRole('textbox', { name: 'URL' }), { target: { value: 'https://example.com/confirm.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(insertImage).toHaveBeenCalledWith({ type: 'image', attrs: { src: 'https://example.com/confirm.png' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lets Dialog handle Escape, restore trigger focus, and then resumes slash-menu Escape handling', async () => {
    const { editor, openSlashMenu } = createSlashMenuEditor();
    render(<RichTextSlashMenu editor={editor} />);

    await act(async () => { openSlashMenu(); });
    const imageButton = screen.getByRole('button', { name: /image/i });
    imageButton.focus();
    fireEvent.mouseDown(imageButton);
    fireEvent.click(imageButton);
    await screen.findByRole('dialog', { name: 'Enter URL' });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(imageButton).toHaveFocus();
    expect(screen.getByText('Image')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Image')).not.toBeInTheDocument());
  });
});

import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import DeleteNoteConfirmModal from './DeleteNoteConfirmModal';

function DeleteHarness({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return <>
    <button ref={openerRef} type="button" onClick={() => setOpen(true)}>删除笔记</button>
    <DeleteNoteConfirmModal
      open={open}
      onCancel={() => setOpen(false)}
      onConfirm={onConfirm}
      openerRef={openerRef}
    />
  </>;
}

describe('DeleteNoteConfirmModal', () => {
  it('uses the shared modal contract and restores focus after Escape', async () => {
    render(<DeleteHarness />);
    const opener = screen.getByRole('button', { name: '删除笔记' });

    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: '删除笔记' });
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '删除' });

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(confirm).not.toHaveFocus();
    expect(cancel).toHaveClass('h-11');
    expect(confirm).toHaveClass('h-11');

    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect(confirm).toHaveFocus());

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('closes through the shared overlay policy without confirming', async () => {
    const onConfirm = vi.fn();
    render(<DeleteHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.pointerDown(dialog.previousElementSibling!);
    fireEvent.click(dialog.previousElementSibling!);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('has no axe violations while open', async () => {
    render(<DeleteHarness />);
    fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
    await screen.findByRole('dialog');

    const result = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });

    expect(result.violations).toEqual([]);
  });
});

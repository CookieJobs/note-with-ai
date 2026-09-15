import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';

function ExampleDialog() {
  return (
    <Dialog>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete note?</DialogTitle>
        <DialogDescription>This cannot be undone.</DialogDescription>
        <DialogClose>Cancel</DialogClose>
        <button type="button">Delete note</button>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('associates its title and description with the dialog', async () => {
    render(<ExampleDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete note?' });
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)).toHaveTextContent(
      'This cannot be undone.',
    );
  });

  it('closes with Escape and restores focus to its trigger', async () => {
    render(<ExampleDialog />);

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('keeps keyboard focus inside the dialog and does not default to a destructive action', async () => {
    render(<ExampleDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = await screen.findByRole('dialog');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const destructiveAction = screen.getByRole('button', { name: 'Delete note' });

    expect(dialog).toHaveFocus();
    expect(destructiveAction).not.toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });

    await waitFor(() => expect(destructiveAction).toHaveFocus());
  });

  it('closes when the user dismisses the overlay', async () => {
    render(<ExampleDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog');

    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

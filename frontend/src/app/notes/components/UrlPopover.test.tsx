import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { UrlPopover } from './UrlPopover';

describe('UrlPopover editor boundary', () => {
  it('marks its fixed overlay as editor-owned so opening it does not commit the note', () => {
    render(
      <UrlPopover onSubmit={vi.fn()}>
        <button type="button">Add link</button>
      </UrlPopover>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));

    expect(screen.getByText('Enter URL').closest('[data-note-editor-inside="true"]')).not.toBeNull();
  });

  it('uses the shared dialog lifecycle with a labelled, initially focused URL field', async () => {
    render(
      <UrlPopover onSubmit={vi.fn()}>
        <button type="button">Add link</button>
      </UrlPopover>,
    );

    const trigger = screen.getByRole('button', { name: 'Add link' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Enter URL' });
    const input = screen.getByRole('textbox', { name: 'URL' });

    expect(input).toHaveFocus();
    expect(dialog).toHaveAttribute('aria-labelledby');

    const axeResult = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(axeResult.violations).toEqual([]);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('keeps focus trapped while the dialog is open', async () => {
    render(
      <UrlPopover onSubmit={vi.fn()}>
        <button type="button">Add link</button>
      </UrlPopover>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const input = await screen.findByRole('textbox', { name: 'URL' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });

    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });

    await waitFor(() => expect(confirm).toHaveFocus());
  });

  it('uses DialogTrigger as the sole pointer opener when its open state is controlled', async () => {
    function ControlledUrlPopover() {
      const [open, setOpen] = useState(false);
      return (
        <UrlPopover open={open} onOpenChange={setOpen} onSubmit={vi.fn()}>
          <button type="button" onMouseDown={(event) => event.preventDefault()}>Add image</button>
        </UrlPopover>
      );
    }

    render(<ControlledUrlPopover />);
    const trigger = screen.getByRole('button', { name: 'Add image' });
    trigger.focus();
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog', { name: 'Enter URL' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

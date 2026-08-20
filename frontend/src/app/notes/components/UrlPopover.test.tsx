import { fireEvent, render, screen } from '@testing-library/react';
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
});

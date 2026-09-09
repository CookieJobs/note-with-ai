import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';

describe('FormField', () => {
  it('connects its label, description, and error to the input', () => {
    render(
      <FormField
        id="note-title"
        label="Title"
        description="Use a short, specific title."
        error="A title is required."
        required
      >
        <input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: /title/i });
    expect(input).toHaveAttribute('id', 'note-title');
    expect(input).toHaveAttribute(
      'aria-describedby',
      'note-title-description note-title-error',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    expect(screen.getByText('Use a short, specific title.')).toHaveAttribute(
      'id',
      'note-title-description',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('A title is required.');
  });
});

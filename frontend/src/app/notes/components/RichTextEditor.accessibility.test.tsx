import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RichTextEditor from './RichTextEditor';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

describe('RichTextEditor accessibility', () => {
  it('exposes the editable note body as a named multiline textbox', () => {
    render(
      <RichTextEditor
        value={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一段笔记' }] }] }}
        onChange={vi.fn()}
        showToolbar={false}
        enableDragHandle={false}
        enableBubbleMenu={false}
        enableSlashMenu={false}
      />
    );

    const editor = screen.getByRole('textbox', { name: '笔记正文' });
    expect(editor).toHaveAttribute('contenteditable', 'true');
    expect(editor).toHaveAttribute('aria-multiline', 'true');
  });
});

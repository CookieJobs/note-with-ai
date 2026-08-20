import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/react';

const tiptap = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  editor: {
    isFocused: false,
    storage: { markdown: { getMarkdown: () => '' } },
    getJSON: () => ({ type: 'doc', content: [] }),
    commands: { setContent: vi.fn(), focus: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@tiptap/react', () => ({
  useEditor: (options: Record<string, unknown>) => {
    tiptap.options = options;
    return tiptap.editor;
  },
  EditorContent: () => <div data-testid="editor-content" />,
}));
vi.mock('./DragHandle', () => ({ DragHandle: () => null }));
vi.mock('./RichTextBubbleMenu', () => ({ RichTextBubbleMenu: () => null }));
vi.mock('./RichTextSlashMenu', () => ({ RichTextSlashMenu: () => null }));
vi.mock('./tiptap/richTextPreset', () => ({
  DEFAULT_RICH_TEXT_PLACEHOLDER: 'Write a note…',
  createRichTextExtensions: () => [],
  isEditorContentSynced: () => true,
  serializeRichTextValue: () => '{}',
}));

import RichTextEditor from './RichTextEditor';

describe('RichTextEditor portal blur boundary', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('[data-test-portal]').forEach((node) => node.remove());
  });

  it('keeps editing when focus moves to a marked control rendered outside the editor root', async () => {
    vi.useFakeTimers();
    const onBlur = vi.fn();
    render(<RichTextEditor value={{ type: 'doc', content: [] } as JSONContent} onChange={vi.fn()} onBlur={onBlur} />);

    const portalControl = document.createElement('button');
    portalControl.dataset.testPortal = 'true';
    portalControl.dataset.noteEditorInside = 'true';
    document.body.append(portalControl);

    const onEditorBlur = tiptap.options?.onBlur as ((context: { event: FocusEvent; editor: typeof tiptap.editor }) => void);
    await act(async () => {
      onEditorBlur({ event: { relatedTarget: portalControl } as unknown as FocusEvent, editor: tiptap.editor });
      vi.runAllTimers();
    });

    expect(onBlur).not.toHaveBeenCalled();
  });

  it('still emits blur after focus leaves the editor boundary', async () => {
    vi.useFakeTimers();
    const onBlur = vi.fn();
    render(<RichTextEditor value={{ type: 'doc', content: [] } as JSONContent} onChange={vi.fn()} onBlur={onBlur} />);

    const outside = document.createElement('button');
    document.body.append(outside);
    const onEditorBlur = tiptap.options?.onBlur as ((context: { event: FocusEvent; editor: typeof tiptap.editor }) => void);
    await act(async () => {
      onEditorBlur({ event: { relatedTarget: outside } as unknown as FocusEvent, editor: tiptap.editor });
      vi.runAllTimers();
    });

    expect(onBlur).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});

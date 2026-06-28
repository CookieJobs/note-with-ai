import type { Editor, JSONContent } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { ResizableImage } from './ResizableImage';

const lowlight = createLowlight(common);

export type RichTextValue = JSONContent | string | null | undefined;

export const DEFAULT_RICH_TEXT_PLACEHOLDER = 'Type "/" for commands';

const sharedExtensions = [
  StarterKit.configure({
    bulletList: {
      HTMLAttributes: {
        class: 'list-disc list-outside leading-3 -mt-2',
      },
    },
    orderedList: {
      HTMLAttributes: {
        class: 'list-decimal list-outside leading-3 -mt-2',
      },
    },
    listItem: {
      HTMLAttributes: {
        class: 'leading-normal -mb-2',
      },
    },
    blockquote: {
      HTMLAttributes: {
        class: 'border-l-4 border-stone-700 pl-4',
      },
    },
    codeBlock: false,
    code: {
      HTMLAttributes: {
        class: 'rounded-md bg-stone-200 px-1.5 py-1 font-mono font-medium text-stone-900',
        spellcheck: 'false',
      },
    },
    horizontalRule: {
      HTMLAttributes: {
        class: 'mt-4 mb-6 border-t border-stone-300',
      },
    },
    dropcursor: {
      color: '#DBEAFE',
      width: 4,
    },
    gapcursor: false,
  }),
  Markdown,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: {
      class: 'text-blue-500 hover:underline',
    },
  }),
  TaskList.configure({
    HTMLAttributes: {
      class: 'not-prose pl-2',
    },
  }),
  TaskItem.configure({
    HTMLAttributes: {
      class: 'flex items-start my-4',
    },
    nested: true,
  }),
  ResizableImage,
  CodeBlockLowlight.configure({
    lowlight,
    HTMLAttributes: {
      class: 'rounded-sm bg-stone-100 p-5 font-mono font-medium text-stone-800',
    },
  }),
  Highlight.configure({
    multicolor: true,
  }),
  TextAlign.configure({
    types: ['heading', 'paragraph'],
  }),
  Table.configure({
    resizable: true,
    HTMLAttributes: {
      class: 'border-collapse table-auto w-full',
    },
  }),
  TableRow,
  TableHeader,
  TableCell,
];

export function createRichTextExtensions(options?: { placeholder?: string }) {
  const placeholder = options?.placeholder;
  if (!placeholder) return sharedExtensions;

  return [
    ...sharedExtensions,
    Placeholder.configure({
      placeholder,
    }),
  ];
}

export function getRichTextMarkdown(editor: Editor | null): string {
  if (!editor) return '';
  return (
    (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ??
    ''
  );
}

export function serializeRichTextValue(value: RichTextValue): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function isEditorContentSynced(editor: Editor | null, value: RichTextValue): boolean {
  if (!editor) return false;

  const incoming = serializeRichTextValue(value);
  if (incoming === null) return false;

  const currentMarkdown = getRichTextMarkdown(editor);
  const currentJson = JSON.stringify(editor.getJSON());

  return incoming === currentMarkdown || incoming === currentJson;
}

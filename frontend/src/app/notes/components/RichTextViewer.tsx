'use client';

import { EditorRoot, EditorContent } from 'novel';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import styles from '../notes.module.scss';

const extensions = [
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
        class: 'border-l-4 border-stone-700',
      },
    },
    codeBlock: {
      HTMLAttributes: {
        class: 'rounded-sm bg-stone-100 p-5 font-mono font-medium text-stone-800',
      },
    },
    code: {
      HTMLAttributes: {
        class: 'rounded-md bg-stone-200 px-1.5 py-1 font-mono font-medium text-stone-900',
      },
    },
    horizontalRule: false,
    dropcursor: {
      color: '#DBEAFE',
      width: 4,
    },
    gapcursor: false,
  }),
  Markdown,
];

export default function RichTextViewer({ value }: { value: string }) {
  if (typeof value !== 'string') {
    return null;
  }

  return (
    <div className={styles.richViewerContent}>
      <EditorRoot>
        <EditorContent
          editable={false}
          initialContent={value as any}
          extensions={extensions as any}
          editorProps={{
            attributes: {
              class: 'prose prose-sm sm:prose-base max-w-full focus:outline-none',
            },
          }}
        />
      </EditorRoot>
    </div>
  );
}



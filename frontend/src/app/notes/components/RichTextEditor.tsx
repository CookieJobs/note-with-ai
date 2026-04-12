'use client';

import React, { useRef, useEffect } from 'react';
import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandItem,
  EditorCommandEmpty,
  EditorCommandList,
  EditorBubble,
  EditorBubbleItem,
  useEditor,
} from 'novel';

function SyncValue({ value, isInside }: { value: any; isInside: (node: Node | null) => boolean }) {
  const { editor } = useEditor();
  const lastUpdateRef = useRef(value);

  useEffect(() => {
    if (!editor) return;
    if (value === undefined || value === null) return;
    
    const curMarkdown = editor.storage.markdown?.getMarkdown();
    if (value === curMarkdown || value === lastUpdateRef.current) return;
    
    try {
      const active = document.activeElement as Node | null;
      if (active && isInside(active)) return;
      if (typeof editor.isFocused === 'function' && editor.isFocused) return;
    } catch {}

    try {
      editor.commands.setContent(value, false);
      lastUpdateRef.current = value;
    } catch {}
  }, [editor, value, isInside]);

  return null;
}
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import styles from '../notes.module.scss';
import { Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3, List, ListOrdered } from 'lucide-react';

type Props = {
  value: any; // Markdown text or JSON
  onChange: (next: { json: any; text: string }) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  onModEnter?: () => void; // Cmd/Ctrl + Enter
  placeholder?: string;
  showToolbar?: boolean;
  toolbarVariant?: 'simple' | 'advanced';
  insideRefs?: Array<React.RefObject<HTMLElement | null>>;
  toolbarRight?: React.ReactNode;
};

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
        spellcheck: 'false',
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

export default function RichTextEditor({
  value,
  onChange,
  onBlur,
  onFocus,
  onModEnter,
  placeholder,
  showToolbar = true,
  toolbarVariant = 'advanced',
  insideRefs = [],
  toolbarRight,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initialContentRef = useRef(value);

  const isInside = React.useCallback((node: Node | null) => {
    if (!node) return false;
    if (rootRef.current && rootRef.current.contains(node)) return true;
    for (const r of insideRefs) {
      const el = r?.current;
      if (el && el.contains(node)) return true;
    }
    return false;
  }, [insideRefs]);

  return (
    <div ref={rootRef} className={styles.richEditor}>
      {showToolbar && toolbarRight && (
        <div className={styles.richToolbar}>
          <span className={styles.richToolbarSpacer} />
          <span className={styles.richToolbarRight}>{toolbarRight}</span>
        </div>
      )}
      <div className={styles.richEditorScroller}>
        <EditorRoot>
          <SyncValue value={value} isInside={isInside} />
          <EditorContent
            className="w-full"
            initialContent={initialContentRef.current as any}
            extensions={extensions as any}
            editorProps={{
              attributes: {
                class: 'prose prose-sm sm:prose-base focus:outline-none max-w-full',
              },
              handleDOMEvents: {
                keydown: (_view, event) => {
                  const e = event as KeyboardEvent;
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    onModEnter?.();
                    return true;
                  }
                  return false;
                },
              },
            }}
            onUpdate={({ editor }) => {
              const markdown = editor.storage.markdown.getMarkdown();
              const json = editor.getJSON();
              onChange({ json, text: markdown });
            }}
            onFocus={() => onFocus?.()}
            onBlur={() => onBlur?.()}
          >
            {/* Bubble Menu for formatting */}
            <EditorBubble className="flex w-fit max-w-[90vw] overflow-hidden rounded-md border border-muted bg-background shadow-xl">
              <div className="flex px-2 py-1 gap-1">
                <EditorBubbleItem
                  onSelect={(editor) => editor.chain().focus().toggleBold().run()}
                  className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                >
                  <Bold className="w-4 h-4" />
                </EditorBubbleItem>
                <EditorBubbleItem
                  onSelect={(editor) => editor.chain().focus().toggleItalic().run()}
                  className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                >
                  <Italic className="w-4 h-4" />
                </EditorBubbleItem>
                <EditorBubbleItem
                  onSelect={(editor) => editor.chain().focus().toggleStrike().run()}
                  className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                >
                  <Strikethrough className="w-4 h-4" />
                </EditorBubbleItem>
                <EditorBubbleItem
                  onSelect={(editor) => editor.chain().focus().toggleCode().run()}
                  className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                >
                  <Code className="w-4 h-4" />
                </EditorBubbleItem>
              </div>
            </EditorBubble>

            {/* Slash Command Menu */}
            <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-muted bg-background px-1 py-2 shadow-md transition-all">
              <EditorCommandEmpty className="px-2 text-muted-foreground">No results</EditorCommandEmpty>
              <EditorCommandList>
                <EditorCommandItem
                  onCommand={({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
                  }}
                  className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent cursor-pointer"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                    <Heading1 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">Heading 1</p>
                    <p className="text-xs text-muted-foreground">Big section heading.</p>
                  </div>
                </EditorCommandItem>
                <EditorCommandItem
                  onCommand={({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
                  }}
                  className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent cursor-pointer"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                    <Heading2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">Heading 2</p>
                    <p className="text-xs text-muted-foreground">Medium section heading.</p>
                  </div>
                </EditorCommandItem>
                <EditorCommandItem
                  onCommand={({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
                  }}
                  className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent cursor-pointer"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                    <Heading3 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">Heading 3</p>
                    <p className="text-xs text-muted-foreground">Small section heading.</p>
                  </div>
                </EditorCommandItem>
                <EditorCommandItem
                  onCommand={({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).toggleBulletList().run();
                  }}
                  className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent cursor-pointer"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                    <List className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">Bullet List</p>
                    <p className="text-xs text-muted-foreground">Create a simple bulleted list.</p>
                  </div>
                </EditorCommandItem>
                <EditorCommandItem
                  onCommand={({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).toggleOrderedList().run();
                  }}
                  className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent cursor-pointer"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                    <ListOrdered className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">Numbered List</p>
                    <p className="text-xs text-muted-foreground">Create a list with numbering.</p>
                  </div>
                </EditorCommandItem>
              </EditorCommandList>
            </EditorCommand>
          </EditorContent>
        </EditorRoot>
      </div>
    </div>
  );
}

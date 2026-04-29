'use client';

import React, { useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import { DragHandle } from './DragHandle';
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
import { ResizableImage } from './tiptap/ResizableImage';
import styles from '../styles/rich-editor.module.scss';
import { RichTextBubbleMenu } from './RichTextBubbleMenu';
import { RichTextSlashMenu } from './RichTextSlashMenu';

const lowlight = createLowlight(common);

type Props = {
  value: JSONContent | string | null | undefined; // Markdown text or JSON
  onChange: (next: { json: JSONContent; text: string }) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  onModEnter?: () => void; // Cmd/Ctrl + Enter
  placeholder?: string;
  showToolbar?: boolean;
  toolbarVariant?: 'simple' | 'advanced';
  insideRefs?: Array<React.RefObject<HTMLElement | null>>;
  toolbarRight?: React.ReactNode;
  autoFocus?: boolean | 'start' | 'end' | 'all';
  className?: string;
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
  Link?.configure({
    openOnClick: false,
    HTMLAttributes: {
      class: 'text-blue-500 hover:underline',
    },
  }),
  TaskList?.configure({
    HTMLAttributes: {
      class: 'not-prose pl-2',
    },
  }),
  TaskItem?.configure({
    HTMLAttributes: {
      class: 'flex items-start my-4',
    },
    nested: true,
  }),
  ResizableImage,
  CodeBlockLowlight?.configure({
    lowlight,
    HTMLAttributes: {
      class: 'rounded-sm bg-stone-100 p-5 font-mono font-medium text-stone-800',
    },
  }),
  Highlight?.configure({
    multicolor: true,
  }),
  TextAlign?.configure({
    types: ['heading', 'paragraph'],
  }),
  Table?.configure({
    resizable: true,
    HTMLAttributes: {
      class: 'border-collapse table-auto w-full',
    },
  }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({
    placeholder: 'Type "/" for commands',
  }),
].filter(Boolean);

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
  autoFocus,
  className = '',
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const initialContentRef = useRef(value);
  const lastUpdateRef = useRef<string | null>(null);

  const searchParams = useSearchParams();
  const isFullscreen = searchParams?.get('mode') === 'fullscreen';

  const editorContentClassName = React.useMemo(
    () => `${styles.richEditorContent} prose prose-sm sm:prose-base focus:outline-none ${className} ${isFullscreen ? '!max-w-[800px] !mx-auto !px-6 !py-10' : ''}`,
    [isFullscreen, className]
  );

  const memoizedExtensions = React.useMemo(() => extensions, []);
  const getMarkdown = React.useCallback(
    (instance: NonNullable<typeof editor>) =>
      ((instance.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? ''),
    []
  );
  
  const memoizedEditorProps = React.useMemo(() => ({
    attributes: {
      class: editorContentClassName,
      'data-rich-text-editor-content': 'true',
    },
    handleDOMEvents: {
      keydown: (_view: unknown, event: Event) => {
        const e = event as KeyboardEvent;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          onModEnter?.();
          return true;
        }
        return false;
      },
    },
  }), [editorContentClassName, onModEnter]);

  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const editor = useEditor({
    extensions: memoizedExtensions,
    editorProps: memoizedEditorProps,
    content: initialContentRef.current,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const markdown = getMarkdown(editor);
      const json = editor.getJSON();
      onChange({ json, text: markdown });
    },
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.(),
  });

  // SyncValue equivalent
  useEffect(() => {
    if (!editor) return;
    if (value === undefined || value === null) return;
    
    const incomingStr = typeof value === 'string' ? value : JSON.stringify(value);
    if (incomingStr === lastUpdateRef.current) return;
    
    const curMarkdown = getMarkdown(editor);
    const curJsonStr = JSON.stringify(editor.getJSON());
    
    if (incomingStr === curMarkdown || incomingStr === curJsonStr) {
      lastUpdateRef.current = incomingStr;
      return;
    }
    
    if (editor.isFocused) return;

    try {
      editor.commands.setContent(value, { emitUpdate: false });
      lastUpdateRef.current = incomingStr;
    } catch (e) {
      console.error('SyncValue setContent error:', e);
    }
  }, [editor, value]);

  // AutoFocus equivalent
  useEffect(() => {
    if (!editor || !autoFocus) return;
    
    requestAnimationFrame(() => {
      if (editor.isFocused) return;
      try {
        editor.commands.focus(autoFocus);
      } catch (e) {
        console.error('Failed to focus editor:', e);
      }
    });
  }, [editor, autoFocus]);

  if (!editor || !mounted) {
    return null;
  }

  return (
    <div ref={rootRef} className={styles.richEditor} data-rich-text-editor-root="true" onClick={() => {
      // Let tiptap handle clicks if it's within ProseMirror's padded area
      const editorNode = scrollerRef.current?.querySelector('.ProseMirror') as HTMLElement;
      if (editorNode && document.activeElement !== editorNode && !editorNode.contains(document.activeElement)) {
        editorNode.focus();
      }
    }}>
      {showToolbar && toolbarRight && (
        <div className={styles.richToolbar}>
          <span className={styles.richToolbarSpacer} />
          <span className={styles.richToolbarRight}>{toolbarRight}</span>
        </div>
      )}
      <div ref={scrollerRef} className={styles.richEditorScroller} data-rich-text-editor-scroller="true">
        {editor && <DragHandle editor={editor} />}
        <div ref={frameRef} className={styles.richEditorFrame} data-rich-text-editor-frame="true">
          <EditorContent
            className={`${styles.richEditorContent} w-full`}
            editor={editor}
          />
          {/* Bubble Menu for formatting */}
          <RichTextBubbleMenu editor={editor} />

          {/* Slash Command Menu */}
          <RichTextSlashMenu editor={editor} />
        </div>
      </div>
    </div>
  );
}

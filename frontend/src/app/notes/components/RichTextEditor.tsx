'use client';

import React, { useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import { DragHandle } from './DragHandle';
import styles from '../styles/rich-editor.module.scss';
import { RichTextBubbleMenu } from './RichTextBubbleMenu';
import { RichTextSlashMenu } from './RichTextSlashMenu';
import {
  createRichTextExtensions,
  DEFAULT_RICH_TEXT_PLACEHOLDER,
  isEditorContentSynced,
  serializeRichTextValue,
  type RichTextValue,
} from './tiptap/richTextPreset';

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
  const initialContentRef = useRef<RichTextValue>(value);
  const lastUpdateRef = useRef<string | null>(serializeRichTextValue(value));

  const searchParams = useSearchParams();
  const isFullscreen = searchParams?.get('mode') === 'fullscreen';

  // 当前仍保留这两个 props 的公开契约，避免影响调用侧；待后续统一收敛时再移除。
  void toolbarVariant;
  void insideRefs;

  const editorContentClassName = React.useMemo(
    () => `${styles.richEditorContent} prose prose-sm sm:prose-base focus:outline-none ${className} ${isFullscreen ? '!max-w-[800px] !mx-auto !px-6 !py-10' : ''}`,
    [isFullscreen, className]
  );

  const memoizedExtensions = React.useMemo(
    () =>
      createRichTextExtensions({
        placeholder: placeholder ?? DEFAULT_RICH_TEXT_PLACEHOLDER,
      }),
    [placeholder]
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

  const editor = useEditor({
    extensions: memoizedExtensions,
    editorProps: memoizedEditorProps,
    content: initialContentRef.current,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const markdown =
        ((editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ??
          '');
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

    const incomingStr = serializeRichTextValue(value);
    if (incomingStr === null) return;
    if (incomingStr === lastUpdateRef.current) return;

    if (isEditorContentSynced(editor, value)) {
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

  if (!editor) {
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
            className={`${styles.richEditorContent} ${styles.richEditorDragGutter} w-full`}
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

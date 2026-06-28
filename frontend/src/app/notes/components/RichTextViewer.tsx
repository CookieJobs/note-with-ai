'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import styles from '../styles/rich-editor.module.scss';
import {
  createRichTextExtensions,
  isEditorContentSynced,
  serializeRichTextValue,
  type RichTextValue,
} from './tiptap/richTextPreset';

export default function RichTextViewer({ value }: { value: string | JSONContent | null | undefined }) {
  const [mounted, setMounted] = useState(false);
  const initialContentRef = useRef<RichTextValue>(value);
  const lastUpdateRef = useRef<string | null>(serializeRichTextValue(value));

  useEffect(() => {
    setMounted(true);
  }, []);

  const memoizedExtensions = React.useMemo(() => createRichTextExtensions(), []);

  const editor = useEditor({
    extensions: memoizedExtensions,
    content: initialContentRef.current,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base max-w-full focus:outline-none',
      },
    },
  });

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

    try {
      editor.commands.setContent(value, { emitUpdate: false });
      lastUpdateRef.current = incomingStr;
    } catch (e) {
      console.error('Sync viewer content error:', e);
    }
  }, [editor, value]);

  if ((typeof value !== 'string' && typeof value !== 'object') || !editor || !mounted) {
    return null;
  }

  return (
    <div className={styles.richViewerContent}>
      <EditorContent editor={editor} />
    </div>
  );
}

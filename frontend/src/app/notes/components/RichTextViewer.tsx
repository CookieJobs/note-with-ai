'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

import styles from '../notes.module.scss';
import { ImageUpload } from './tiptap/ImageUpload';
import { ResizableImage } from './tiptap/ResizableImage';

export default function RichTextViewer({ value }: { value: any }) {
  const editor = useEditor({
    // Next.js 下避免 hydration mismatch（TipTap 会检测 SSR 并报错）
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: true }),
      ResizableImage.configure({
        wrapperClassName: styles.resizableImage,
        selectedClassName: styles.resizableImageSelected,
      }),
      // 兼容：如果保存时仍存在“图片占位块”，展示态也能渲染占位 UI（只读，不可交互）
      ImageUpload.configure({ placeholderClassName: styles.imageUploadPlaceholder }),
    ],
    content: value || undefined,
    editorProps: {
      attributes: {
        class: styles.richViewerContent,
      },
    },
  });

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}



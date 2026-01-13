'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import TextAlign from '@tiptap/extension-text-align';

import styles from '../notes.module.scss';
import { ResizableImage } from './tiptap/ResizableImage';
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node/image-upload-node-extension';

export default function RichTextViewer({ value }: { value: any }) {
  const editor = useEditor({
    // Next.js 下避免 hydration mismatch（TipTap 会检测 SSR 并报错）
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      Underline,
      Superscript,
      Subscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: true }),
      ResizableImage.configure({
        wrapperClassName: styles.resizableImage,
        selectedClassName: styles.resizableImageSelected,
      }),
      // 兼容：如果保存时仍存在“图片上传占位块”，展示态也能渲染（已在组件内禁用交互）
      ImageUploadNode,
    ],
    content: value || undefined,
    editorProps: {
      attributes: {
        class: `tiptap ${styles.richViewerContent}`,
      },
    },
  });

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}



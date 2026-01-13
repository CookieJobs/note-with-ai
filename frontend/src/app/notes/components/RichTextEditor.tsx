'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import TextAlign from '@tiptap/extension-text-align';
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node/image-upload-node-extension';
import { ResizableImage } from './tiptap/ResizableImage';

// TipTap 官方 UI Components（已通过 @tiptap/cli 安装到 src/components）
import { MarkButton } from '@/components/tiptap-ui/mark-button';
import { ListButton } from '@/components/tiptap-ui/list-button';
import { BlockquoteButton } from '@/components/tiptap-ui/blockquote-button';
import { CodeBlockButton } from '@/components/tiptap-ui/code-block-button';
import { LinkPopover } from '@/components/tiptap-ui/link-popover';
import { TextAlignButton } from '@/components/tiptap-ui/text-align-button';
import { ImageUploadButton } from '@/components/tiptap-ui/image-upload-button';

import { ButtonGroup } from '@/components/tiptap-ui-primitive/button';
import { Separator } from '@/components/tiptap-ui-primitive/separator';

import styles from '../notes.module.scss';

function safeStringify(v: any): string {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return '';
  }
}

function extractPlainTextFromJson(doc: any): string {
  // 目的：让“只有图片/无文字”也能产生非空 contentText（用于按钮可用、搜索/embedding）
  // 规则：text 节点拼接；image 节点输出 "[图片]"；段落/块之间保留换行（尽量少但可读）
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    const type = node.type;
    if (type === 'text' && typeof node.text === 'string') {
      out.push(node.text);
      return;
    }
    if (type === 'image') {
      // 独立成行更符合阅读/embedding
      if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out.push('\n');
      out.push('[图片]');
      out.push('\n');
      return;
    }
    if (type === 'imageUpload') {
      if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out.push('\n');
      out.push('[图片]');
      out.push('\n');
      return;
    }
    if (type === 'hardBreak') {
      out.push('\n');
      return;
    }
    const content = Array.isArray(node.content) ? node.content : [];
    for (const c of content) walk(c);
    // 块级节点后补一个换行（避免全挤在一起）
    if (type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'listItem') {
      if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out.push('\n');
    }
  };
  walk(doc);
  const s = out.join('');
  // 规整多余换行
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

type Props = {
  value: any; // TipTap/ProseMirror JSON doc
  onChange: (next: { json: any; text: string }) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  onModEnter?: () => void; // Cmd/Ctrl + Enter
  placeholder?: string;
  showToolbar?: boolean; // 展示态可隐藏 toolbar（例如快速记录未 composing 时）
  insideRefs?: Array<React.RefObject<HTMLElement | null>>;
};

export default function RichTextEditor({
  value,
  onChange,
  onBlur,
  onFocus,
  onModEnter,
  placeholder,
  showToolbar = true,
  insideRefs = [],
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const blurGuardRef = useRef(false);
  const didInitSelectionRef = useRef(false);
  const suppressBlurUntilRef = useRef(0); // 文件选择器/内部交互会导致 relatedTarget=null 的 blur，短暂抑制退出
  const lastSelfUpdateJsonStrRef = useRef(''); // 避免“受控 value 同步”把 selection 重置
  const isTiptapOverlay = (node: Node | null) => {
    // 官方 UI primitives 使用 Radix Portal，把 Popover/Tooltip 渲染到 body 下；
    // 这些交互不应该触发“编辑器失焦退出编辑态”
    const el = node as HTMLElement | null;
    if (!el || typeof (el as any).closest !== 'function') return false;
    return !!el.closest('.tiptap-popover, .tiptap-tooltip');
  };
  const isInside = (node: Node | null) => {
    if (!node) return false;
    if (isTiptapOverlay(node)) return true;
    if (rootRef.current && rootRef.current.contains(node)) return true;
    for (const r of insideRefs) {
      const el = r?.current;
      if (el && el.contains(node)) return true;
    }
    return false;
  };
  const editor = useEditor({
    // Next.js 下避免 hydration mismatch（TipTap 会检测 SSR 并报错）
    immediatelyRender: false,
    extensions: [
      // 使用官方默认列表（Tab/Shift+Tab 缩进/反缩进行为由 TipTap/ProseMirror 默认处理）
      StarterKit,
      Underline,
      Superscript,
      Subscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false }),
      ResizableImage.configure({
        wrapperClassName: styles.resizableImage,
        selectedClassName: styles.resizableImageSelected,
        editableClassName: styles.resizableImageEditable,
      }),
      ImageUploadNode.configure({
        type: 'image',
        limit: 1,
        maxSize: 10 * 1024 * 1024,
        upload: async (file: File, onProgress, abortSignal) => {
          // 直接转 base64 dataURL（无需后端上传）。注意：大图片会增加 contentJson 体积。
          if (abortSignal?.aborted) throw new Error('Upload cancelled');
          const toDataUrl = (f: File) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error('读取文件失败'));
              reader.onload = () => resolve(String(reader.result || ''));
              reader.readAsDataURL(f);
            });
          onProgress?.({ progress: 10 });
          const url = await toDataUrl(file);
          onProgress?.({ progress: 100 });
          return url;
        },
        onError: (err: Error) => {
          console.warn('图片插入失败:', err);
        },
      }),
      Placeholder.configure({
        placeholder: placeholder || '',
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content: value || undefined,
    editorProps: {
      attributes: {
        // 重要：保留 TipTap UI Components 依赖的 `.tiptap` class（其 node 样式选择器是 `.tiptap.ProseMirror`）
        class: `tiptap ${styles.richEditorContent}`,
        // 关闭浏览器拼写检查/自动纠错（去掉红色波浪线）
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        // 兼容：禁用 Grammarly 等浏览器插件对 contenteditable 的注入
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
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
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      lastSelfUpdateJsonStrRef.current = safeStringify(json);
      const text = extractPlainTextFromJson(json);
      onChange({ json, text });
    },
    onFocus: () => {
      onFocus?.();
    },
    onBlur: ({ event }) => {
      if (Date.now() < suppressBlurUntilRef.current) return;
      // 点击 toolbar 按钮会让编辑器失焦，但我们不希望因此退出编辑态
      const next = (event as FocusEvent | undefined)?.relatedTarget as Node | null;
      if (isInside(next)) return;
      // 退出前先清掉 node selection（避免“图片选中态”看起来残留）
      try {
        editor?.commands.setTextSelection(0);
      } catch {
        // ignore
      }
      onBlur?.();
    },
  });

  // 兜底：点击编辑器外部时退出编辑（比依赖 blur 更可靠）
  useEffect(() => {
    const onPointerDownCapture = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (isInside(target)) {
        // 在编辑器内部交互（尤其是图片占位块触发文件选择器）会导致 ProseMirror blur，
        // 但这不应退出编辑态
        suppressBlurUntilRef.current = Date.now() + 1500;
        return;
      } // 编辑器内部（含 toolbar/外部控制区）不退出

      // 只有当“当前焦点在编辑器内部”时，才认为这是一次“点击外部退出”
      const active = document.activeElement as Node | null;
      if (!active || !isInside(active)) return;

      if (blurGuardRef.current) return;
      blurGuardRef.current = true;
      try {
        onBlur?.();
      } finally {
        // 下一帧解除，避免和 TipTap blur 重复触发
        requestAnimationFrame(() => {
          blurGuardRef.current = false;
        });
      }
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [onBlur]);

  // 外部 value 变化时同步（例如切换 note 或冲突回滚）
  useEffect(() => {
    if (!editor) return;
    if (!value) return;
    const nextStr = safeStringify(value);
    // 关键：如果 value 是来自 editor 自己的 onUpdate 回传，不要 setContent（否则会重置光标/selection）
    if (nextStr && nextStr === lastSelfUpdateJsonStrRef.current) return;
    // 如果编辑器当前内容已经一致，也不要 setContent（避免不必要的 selection 重置）
    try {
      const curStr = safeStringify(editor.getJSON());
      if (nextStr && curStr && nextStr === curStr) return;
    } catch {
      // ignore
    }
    // 编辑中（焦点在编辑器内）时，不做 setContent 同步：否则会导致光标/selection 跳到末尾
    try {
      const active = document.activeElement as Node | null;
      if (active && isInside(active)) return;
      if (typeof editor.isFocused === 'function' && editor.isFocused) return;
    } catch {
      // ignore
    }
    try {
      editor.commands.setContent(value, { emitUpdate: false });
    } catch {
      // ignore
    }
  }, [editor, value]);

  // 进入编辑态时：自动聚焦，并把光标放到第一个字符（而不是末尾）
  useEffect(() => {
    if (!editor) return;
    if (didInitSelectionRef.current) return;

    requestAnimationFrame(() => {
      try {
        editor.commands.focus('start');
        editor.commands.setTextSelection(0);
      } catch {
        // ignore
      } finally {
        didInitSelectionRef.current = true;
      }
    });
  }, [editor]);

  if (!editor) return null;

  return (
    <div ref={rootRef} className={styles.richEditor}>
      {showToolbar && (
        <div className={styles.richToolbar}>
          <ButtonGroup orientation="horizontal">
            <MarkButton editor={editor} type="bold" />
            <MarkButton editor={editor} type="italic" />
            <MarkButton editor={editor} type="underline" />
            <MarkButton editor={editor} type="strike" />
            <MarkButton editor={editor} type="code" />
            <MarkButton editor={editor} type="superscript" />
            <MarkButton editor={editor} type="subscript" />
          </ButtonGroup>

          <Separator />

          <ButtonGroup orientation="horizontal">
            <ListButton editor={editor} type="bulletList" />
            <ListButton editor={editor} type="orderedList" />
          </ButtonGroup>

          <Separator />

          <ButtonGroup orientation="horizontal">
            <BlockquoteButton editor={editor} />
            <CodeBlockButton editor={editor} />
          </ButtonGroup>

          <Separator />

          <ButtonGroup orientation="horizontal">
            <TextAlignButton editor={editor} align="left" />
            <TextAlignButton editor={editor} align="center" />
            <TextAlignButton editor={editor} align="right" />
            <TextAlignButton editor={editor} align="justify" />
          </ButtonGroup>

          <Separator />

          <ButtonGroup orientation="horizontal">
            <LinkPopover editor={editor} />
            <ImageUploadButton editor={editor} />
          </ButtonGroup>
        </div>
      )}

      {/* 关键：用一个稳定的滚动容器包住 EditorContent，避免编辑态被外层 overflow:hidden 裁剪后无法滚动 */}
      <div className={styles.richEditorScroller}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}



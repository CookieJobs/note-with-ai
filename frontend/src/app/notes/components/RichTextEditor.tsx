'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { ImageUpload } from './tiptap/ImageUpload';
import { ResizableImage } from './tiptap/ResizableImage';
import { ListItemWithEmptyParent } from './tiptap/ListItemWithEmptyParent';
import { BulletListWithIndent } from './tiptap/BulletListWithIndent';
import { OrderedListWithIndent } from './tiptap/OrderedListWithIndent';
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Image as ImageIcon,
} from 'lucide-react';

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
  const isInside = (node: Node | null) => {
    if (!node) return false;
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
      StarterKit.configure({ listItem: false, bulletList: false, orderedList: false }),
      BulletListWithIndent,
      OrderedListWithIndent,
      ListItemWithEmptyParent,
      Link.configure({ openOnClick: false }),
      ResizableImage.configure({
        wrapperClassName: styles.resizableImage,
        selectedClassName: styles.resizableImageSelected,
        editableClassName: styles.resizableImageEditable,
      }),
      ImageUpload.configure({ placeholderClassName: styles.imageUploadPlaceholder }),
      Placeholder.configure({
        placeholder: placeholder || '',
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content: value || undefined,
    editorProps: {
      attributes: {
        class: styles.richEditorContent,
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          const e = event as KeyboardEvent;
          // 列表缩进：Tab / Shift+Tab
          // - Tab: sinkListItem => 变成二级列表
          // - Shift+Tab: liftListItem => 回到上一级
          if (e.key === 'Tab') {
            // 只在列表语境下处理，避免影响普通 Tab（浏览器焦点切换）
            const inList = editor?.isActive('bulletList') || editor?.isActive('orderedList') || editor?.isActive('listItem');
            if (inList) {
              e.preventDefault();
              if (e.shiftKey) {
                // Shift+Tab：优先减少“列表整体缩进”，否则回到上一级列表
                const didOutdentList = editor
                  ?.chain()
                  .focus()
                  .command(({ tr, state, dispatch }) => {
                    const { selection, schema } = state;
                    const $from = selection.$from;
                    const bulletList = schema.nodes.bulletList;
                    const orderedList = schema.nodes.orderedList;
                    let listDepth = -1;
                    for (let d = $from.depth; d > 0; d -= 1) {
                      const t = $from.node(d).type;
                      if (t === bulletList || t === orderedList) {
                        listDepth = d;
                        break;
                      }
                    }
                    if (listDepth === -1) return false;
                    const node = $from.node(listDepth);
                    const indent = Number((node.attrs as any)?.indent || 0);
                    if (indent <= 0) return false;
                    const pos = $from.before(listDepth);
                    tr.setNodeMarkup(pos, undefined, { ...(node.attrs as any), indent: indent - 1 });
                    if (dispatch) dispatch(tr);
                    return true;
                  })
                  .run();
                if (!didOutdentList) {
                  if (editor?.can().liftListItem('listItem')) editor.chain().focus().liftListItem('listItem').run();
                }
              } else {
                // Tab：如果当前 listItem 是“空行”，则对“整个列表起始位置”做缩进（不创建二级列表）
                const didIndentList = editor
                  ?.chain()
                  .focus()
                  .command(({ tr, state, dispatch }) => {
                    const { selection, schema } = state;
                    const $from = selection.$from;
                    const listItem = schema.nodes.listItem;
                    const paragraph = schema.nodes.paragraph;
                    const bulletList = schema.nodes.bulletList;
                    const orderedList = schema.nodes.orderedList;
                    if (!listItem || !paragraph || !bulletList || !orderedList) return false;

                    // 必须在空的 listItem 段落里
                    if ($from.parent.type !== paragraph) return false;
                    if ($from.parent.content.size !== 0) return false;

                    // 找到最近的 listItem 与其父 list
                    let liDepth = -1;
                    let listDepth = -1;
                    for (let d = $from.depth; d > 0; d -= 1) {
                      const t = $from.node(d).type;
                      if (liDepth === -1 && t === listItem) liDepth = d;
                      if (t === bulletList || t === orderedList) {
                        listDepth = d;
                        break;
                      }
                    }
                    if (liDepth === -1 || listDepth === -1) return false;

                    const listNode = $from.node(listDepth);
                    const indent = Number((listNode.attrs as any)?.indent || 0);
                    const nextIndent = Math.min(6, indent + 1);
                    if (nextIndent === indent) return false;
                    const pos = $from.before(listDepth);
                    tr.setNodeMarkup(pos, undefined, { ...(listNode.attrs as any), indent: nextIndent });
                    if (dispatch) dispatch(tr);
                    return true;
                  })
                  .run();

                if (!didIndentList) {
                  // 否则才是常规的“二级列表”
                  if (editor?.can().sinkListItem('listItem')) editor.chain().focus().sinkListItem('listItem').run();
                }
              }
              return true;
            }
          }
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

  const btn = (active: boolean) => `${styles.richToolbarBtn} ${active ? styles.richToolbarBtnActive : ''}`;
  const keepFocus = (e: React.MouseEvent) => {
    // 防止按钮抢焦点触发 editor blur（但 click 仍会触发命令）
    e.preventDefault();
  };

  return (
    <div ref={rootRef} className={styles.richEditor}>
      {showToolbar && (
        <div className={styles.richToolbar}>
          <button
            type="button"
            className={btn(editor.isActive('bold'))}
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label="加粗"
            title="加粗"
          >
            <Bold size={16} />
          </button>
          <button
            type="button"
            className={btn(editor.isActive('italic'))}
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label="斜体"
            title="斜体"
          >
            <Italic size={16} />
          </button>
          <button
            type="button"
            className={btn(editor.isActive('strike'))}
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            aria-label="删除线"
            title="删除线"
          >
            <Strikethrough size={16} />
          </button>
          <button
            type="button"
            className={btn(editor.isActive('bulletList'))}
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            aria-label="无序列表"
            title="无序列表"
          >
            <List size={16} />
          </button>
          <button
            type="button"
            className={btn(editor.isActive('orderedList'))}
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            aria-label="有序列表"
            title="有序列表"
          >
            <ListOrdered size={16} />
          </button>
          <button
            type="button"
            className={btn(editor.isActive('blockquote'))}
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            aria-label="引用"
            title="引用"
          >
            <Quote size={16} />
          </button>
          <button
            type="button"
            className={styles.richToolbarBtn}
            onMouseDown={keepFocus}
            onClick={() => {
              // 直接插入占位块节点（避免依赖自定义 chain command 在某些场景未注册）
              editor.chain().focus().insertContent({ type: 'imageUpload' }).run();
            }}
            aria-label="插入图片"
            title="插入图片"
          >
            <ImageIcon size={16} />
          </button>
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}



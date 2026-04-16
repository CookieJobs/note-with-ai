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
  GlobalDragHandle,
  Command,
  renderItems,
} from 'novel';

const EDITOR_FOCUS_SELECTOR = '.ProseMirror, [contenteditable="true"]';

function getEditableElement(root: HTMLDivElement | null) {
  if (!root) return null;
  return root.querySelector(EDITOR_FOCUS_SELECTOR) as HTMLElement | null;
}

function isEditableFocused(root: HTMLDivElement | null) {
  const editable = getEditableElement(root);
  const active = document.activeElement;

  if (!editable || !active) return false;
  return active === editable || editable.contains(active);
}

function focusEditable({
  root,
  editor,
  position,
}: {
  root: HTMLDivElement | null;
  editor: any;
  position?: boolean | 'start' | 'end' | 'all';
}) {
  const editable = getEditableElement(root);
  if (!root || !editable || !root.isConnected || !editable.isConnected) return false;

  try {
    editable.focus({ preventScroll: true });
  } catch {
    try {
      editable.focus();
    } catch {}
  }

  try {
    if (position === true || position === undefined) {
      editor.commands.focus();
    } else {
      editor.commands.focus(position);
    }
  } catch {}

  if (!isEditableFocused(root)) {
    try {
      editable.focus({ preventScroll: true });
    } catch {
      try {
        editable.focus();
      } catch {}
    }
  }

  return isEditableFocused(root) || editor.isFocused;
}

function SyncValue({ value, isInside }: { value: any; isInside: (node: Node | null) => boolean }) {
  const { editor } = useEditor();
  const lastUpdateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    if (value === undefined || value === null) return;
    
    // 把 incoming value 统一当字符串处理进行对比，防止对象引用引发死循环
    const incomingStr = typeof value === 'string' ? value : JSON.stringify(value);
    
    // 如果 incoming 的数据和上次 setContent 进去的一样，跳过
    if (incomingStr === lastUpdateRef.current) return;
    
    // 获取当前编辑器内容
    const curMarkdown = editor.storage.markdown?.getMarkdown();
    const curJsonStr = JSON.stringify(editor.getJSON());
    
    // 如果 incoming 和当前内容一样，跳过
    if (incomingStr === curMarkdown || incomingStr === curJsonStr) {
      lastUpdateRef.current = incomingStr;
      return;
    }
    
    try {
      const active = document.activeElement as Node | null;
      if (active && isInside(active)) return;
      if (editor.isFocused) return;
    } catch {}

    try {
      editor.commands.setContent(value, false);
      lastUpdateRef.current = incomingStr;
    } catch {}
  }, [editor, value, isInside]);

  return null;
}

function FocusOnPointerDown({
  rootRef,
  scrollerRef,
  frameRef,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  frameRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { editor } = useEditor();

  useEffect(() => {
    const root = rootRef.current;
    const scroller = scrollerRef.current;
    const frame = frameRef.current;
    if (!editor || !root || !scroller || !frame) return;

    const handlePointerDown = (event: PointerEvent) => {
      const rawTarget = event.target;
      const target =
        rawTarget instanceof HTMLElement
          ? rawTarget
          : rawTarget instanceof Text
            ? rawTarget.parentElement
            : null;

      if (!target || !root.contains(target)) return;
      if (target.closest(`.${styles.richToolbar}`)) return;
      if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
      if (target.closest('[data-rich-text-editor-content="true"], .ProseMirror')) return;
      if (
        !target.closest('[data-rich-text-editor-scroller="true"]') &&
        !target.closest('[data-rich-text-editor-frame="true"]') &&
        !target.closest('.tiptap')
      ) {
        return;
      }

      event.preventDefault();

      if (isEditableFocused(root) || editor.isFocused) return;

      focusEditable({ root, editor, position: 'end' });
    };

    scroller.addEventListener('pointerdown', handlePointerDown, true);
    frame.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      scroller.removeEventListener('pointerdown', handlePointerDown, true);
      frame.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [editor, frameRef, rootRef, scrollerRef]);

  return null;
}

function AutoFocus({
  autoFocus,
  rootRef,
}: {
  autoFocus?: boolean | 'start' | 'end' | 'all';
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { editor } = useEditor();
  const didFocusRef = useRef(false);

  useEffect(() => {
    didFocusRef.current = false;
  }, [editor]);

  useEffect(() => {
    if (!editor || didFocusRef.current || !autoFocus) return;

    let cancelled = false;
    let rafId = 0;
    let attempts = 0;

    const tryFocus = () => {
      if (cancelled || didFocusRef.current) return;

      const root = rootRef.current;
      const content = getEditableElement(root);

      if (!root || !content || !root.isConnected || !content.isConnected) {
        if (attempts < 12) {
          attempts += 1;
          rafId = requestAnimationFrame(tryFocus);
        }
        return;
      }

      if (editor.isFocused || isEditableFocused(root)) {
        didFocusRef.current = true;
        return;
      }

      const focused = focusEditable({ root, editor, position: autoFocus });

      if (focused) {
        didFocusRef.current = true;
        return;
      }

      if (attempts < 12) {
        attempts += 1;
        rafId = requestAnimationFrame(tryFocus);
      }
    };

    rafId = requestAnimationFrame(tryFocus);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [editor, autoFocus, rootRef]);

  return null;
}

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
import styles from '../notes.module.scss';
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Link as LinkIcon, Highlighter, AlignLeft, AlignCenter,
  AlignRight, Quote, Minus, CheckSquare, FileCode2, Table as TableIcon
} from 'lucide-react';

const lowlight = createLowlight(common);

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
  autoFocus?: boolean | 'start' | 'end' | 'all';
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
  ResizableImage?.configure({
    HTMLAttributes: {
      class: 'rounded-lg border border-muted',
    },
  }),
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
  GlobalDragHandle?.configure({
    dragHandleWidth: 20,
    scrollTreshold: 100,
  }),
  Command?.configure({
    suggestion: {
      items: () => [
        {
          title: 'dummy',
          command: ({ editor, range }: { editor: any; range: any }) => {
            editor.chain().focus().deleteRange(range).run();
          },
        },
      ],
      render: renderItems,
    },
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
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const initialContentRef = useRef(value);
  const editorContentClassName = React.useMemo(
    () => `${styles.richEditorContent} prose prose-sm sm:prose-base focus:outline-none max-w-full`,
    []
  );

  const isInside = React.useCallback((node: Node | null) => {
    if (!node) return false;
    if (rootRef.current && rootRef.current.contains(node)) return true;
    for (const r of insideRefs) {
      const el = r?.current;
      if (el && el.contains(node)) return true;
    }
    return false;
  }, [insideRefs]);

  // 将 extensions 提到组件外部或用 useMemo 包装，防止在渲染中被重置导致编辑器销毁重建
  const memoizedExtensions = React.useMemo(() => extensions as any, []);
  
  const memoizedEditorProps = React.useMemo(() => ({
    attributes: {
      class: editorContentClassName,
      'data-rich-text-editor-content': 'true',
    },
    handleDOMEvents: {
      keydown: (_view: any, event: Event) => {
        const e = event as KeyboardEvent;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          onModEnter?.();
          return true; // 拦截默认行为并触发保存
        }
        return false; // 重要：对于其他按键，必须返回 false 才能让 ProseMirror 正常处理文本输入
      },
    },
  }), [editorContentClassName, onModEnter]);

  return (
    <div ref={rootRef} className={styles.richEditor} data-rich-text-editor-root="true">
      {showToolbar && toolbarRight && (
        <div className={styles.richToolbar}>
          <span className={styles.richToolbarSpacer} />
          <span className={styles.richToolbarRight}>{toolbarRight}</span>
        </div>
      )}
      <div ref={scrollerRef} className={styles.richEditorScroller} data-rich-text-editor-scroller="true">
        <div ref={frameRef} className={styles.richEditorFrame} data-rich-text-editor-frame="true">
          <EditorRoot>
            <SyncValue value={value} isInside={isInside} />
            <FocusOnPointerDown rootRef={rootRef} scrollerRef={scrollerRef} frameRef={frameRef} />
            {autoFocus && <AutoFocus autoFocus={autoFocus} rootRef={rootRef} />}
            <EditorContent
              className={`${styles.richEditorContent} w-full`}
              initialContent={initialContentRef.current as any}
              extensions={memoizedExtensions}
              editorProps={memoizedEditorProps}
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
                  <EditorBubbleItem
                    onSelect={(editor) => {
                      const previousUrl = editor.getAttributes('link').href;
                      const url = window.prompt('URL', previousUrl);
                      if (url === null) return;
                      if (url === '') {
                        editor.chain().focus().extendMarkRange('link').unsetLink().run();
                        return;
                      }
                      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                    }}
                    className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                  >
                    <LinkIcon className="w-4 h-4" />
                  </EditorBubbleItem>
                  <EditorBubbleItem
                    onSelect={(editor) => editor.chain().focus().toggleHighlight().run()}
                    className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                  >
                    <Highlighter className="w-4 h-4" />
                  </EditorBubbleItem>
                  <div className="w-px h-8 bg-muted mx-1" />
                  <EditorBubbleItem
                    onSelect={(editor) => editor.chain().focus().setTextAlign('left').run()}
                    className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                  >
                    <AlignLeft className="w-4 h-4" />
                  </EditorBubbleItem>
                  <EditorBubbleItem
                    onSelect={(editor) => editor.chain().focus().setTextAlign('center').run()}
                    className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                  >
                    <AlignCenter className="w-4 h-4" />
                  </EditorBubbleItem>
                  <EditorBubbleItem
                    onSelect={(editor) => editor.chain().focus().setTextAlign('right').run()}
                    className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
                  >
                    <AlignRight className="w-4 h-4" />
                  </EditorBubbleItem>
                </div>
              </EditorBubble>

              {/* Slash Command Menu */}
              <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-slate-200 bg-white px-1 py-2 shadow-lg text-slate-900">
                <EditorCommandEmpty className="px-2 text-slate-500">No results</EditorCommandEmpty>
                <EditorCommandList>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <Heading1 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Heading 1</p>
                      <p className="text-xs text-slate-500">Big section heading.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <Heading2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Heading 2</p>
                      <p className="text-xs text-slate-500">Medium section heading.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <Heading3 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Heading 3</p>
                      <p className="text-xs text-slate-500">Small section heading.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).toggleBulletList().run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <List className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Bullet List</p>
                      <p className="text-xs text-slate-500">Create a simple bulleted list.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <ListOrdered className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Numbered List</p>
                      <p className="text-xs text-slate-500">Create a list with numbering.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <Quote className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Blockquote</p>
                      <p className="text-xs text-slate-500">Capture a quote.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <Minus className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Divider</p>
                      <p className="text-xs text-slate-500">Visually divide blocks.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).toggleTaskList().run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <CheckSquare className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Task List</p>
                      <p className="text-xs text-slate-500">Track tasks with a to-do list.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <FileCode2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Code Block</p>
                      <p className="text-xs text-slate-500">Capture a code snippet.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <TableIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">Table</p>
                      <p className="text-xs text-slate-500">Insert a table.</p>
                    </div>
                  </EditorCommandItem>
                  <EditorCommandItem
                    onCommand={({ editor, range }) => {
                      const url = window.prompt('Image URL');
                      if (url) {
                        editor.chain().focus().deleteRange(range).setImage({ src: url }).run();
                      } else {
                        editor.chain().focus().deleteRange(range).run();
                      }
                    }}
                    className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50 aria-selected:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" className="h-4 w-4"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                    </div>
                    <div>
                      <p className="font-medium">Image</p>
                      <p className="text-xs text-slate-500">Insert an image.</p>
                    </div>
                  </EditorCommandItem>
                </EditorCommandList>
              </EditorCommand>
            </EditorContent>
          </EditorRoot>
        </div>
      </div>
    </div>
  );
}

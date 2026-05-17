import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { Heading1, Heading2, Heading3, List, ListOrdered, Quote, Minus, CheckSquare, FileCode2, Table as TableIcon } from 'lucide-react';
import { UrlPopover } from './UrlPopover';

type SlashCommand = {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  action: (editor: Editor) => void;
};

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Big section heading.',
    icon: Heading1,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading.',
    icon: Heading2,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading.',
    icon: Heading3,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet-list',
    label: 'Bullet List',
    description: 'Create a simple bulleted list.',
    icon: List,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleBulletList().run(),
  },
  {
    id: 'ordered-list',
    label: 'Numbered List',
    description: 'Create a list with numbering.',
    icon: ListOrdered,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    label: 'Blockquote',
    description: 'Capture a quote.',
    icon: Quote,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleBlockquote().run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Visually divide blocks.',
    icon: Minus,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).setHorizontalRule().run(),
  },
  {
    id: 'task-list',
    label: 'Task List',
    description: 'Track tasks with a to-do list.',
    icon: CheckSquare,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleTaskList().run(),
  },
  {
    id: 'code-block',
    label: 'Code Block',
    description: 'Capture a code snippet.',
    icon: FileCode2,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleCodeBlock().run(),
  },
  {
    id: 'table',
    label: 'Table',
    description: 'Insert a table.',
    icon: TableIcon,
    action: (editor) =>
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Insert an image.',
    icon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
    ),
    action: () => {}, // handled separately via popover
  },
];

function shouldShowSlashMenu(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parent.type.name !== 'paragraph') return false;
  return $from.parent.textContent === '/' && $from.parentOffset === 1;
}

function getCursorViewportCoords(editor: Editor) {
  const { from } = editor.state.selection;
  return editor.view.coordsAtPos(from);
}

export function RichTextSlashMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isOpenRef = useRef(false);

  isOpenRef.current = open;

  // Detect "/" trigger
  useEffect(() => {
    if (!editor) return;

    const onTransaction = () => {
      if (shouldShowSlashMenu(editor)) {
        const coords = getCursorViewportCoords(editor);
        setSelectedIndex(0);
        setPosition({ top: coords.bottom, left: coords.left });
        setOpen(true);
      } else {
        setOpen(false);
        setImagePopoverOpen(false);
      }
    };

    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % SLASH_COMMANDS.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const cmd = SLASH_COMMANDS[selectedIndex];
        if (cmd && editor) {
          if (cmd.id === 'image') {
            setImagePopoverOpen(true);
          } else {
            setOpen(false);
            cmd.action(editor);
          }
        }
        return;
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, selectedIndex, editor]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      // Don't close if interacting with the image URL popover
      if ((t as HTMLElement).closest?.('[data-radix-popper-content-wrapper]')) return;
      setOpen(false);
      setImagePopoverOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll('[data-slash-item]');
    const item = items[selectedIndex] as HTMLElement | undefined;
    if (!item) return;

    const container = menuRef.current;
    const ct = container.scrollTop;
    const ch = container.clientHeight;
    const it = item.offsetTop;
    const ih = item.offsetHeight;

    if (it < ct) {
      container.scrollTop = it;
    } else if (it + ih > ct + ch) {
      container.scrollTop = it + ih - ch;
    }
  }, [open, selectedIndex]);

  // Adjust position on open to avoid viewport edges
  const adjustedPosition = useCallback(() => {
    const menuHeight = 330;
    const menuWidth = 256; // w-64
    const padding = 8;

    let { top, left } = position;

    // Flip above if extending past bottom
    if (top + menuHeight > window.innerHeight - padding) {
      top = position.top - menuHeight - 16; // 16px above cursor line
      if (top < padding) top = padding;
    }

    // Keep within horizontal bounds
    if (left + menuWidth > window.innerWidth - padding) {
      left = window.innerWidth - menuWidth - padding;
    }
    if (left < padding) left = padding;

    return { top, left };
  }, [position]);

  if (!open || !editor) return null;

  const pos = adjustedPosition();
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] h-auto max-h-[330px] w-64 overflow-y-auto rounded-md border border-slate-200 bg-white px-1 py-2 shadow-lg"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex flex-col space-y-1">
        {SLASH_COMMANDS.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          const isImage = cmd.id === 'image';

          const button = (
            <button
              key={cmd.id}
              data-slash-item
              onMouseDown={(e) => {
                e.preventDefault();
                if (isImage) {
                  setImagePopoverOpen(true);
                } else {
                  setOpen(false);
                  cmd.action(editor);
                }
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer ${
                isSelected ? 'bg-slate-100 text-slate-900' : 'text-slate-900 hover:bg-slate-50'
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                <cmd.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">{cmd.label}</p>
                <p className="text-xs text-slate-500">{cmd.description}</p>
              </div>
            </button>
          );

          if (isImage) {
            return (
              <UrlPopover
                key={cmd.id}
                open={imagePopoverOpen}
                onOpenChange={setImagePopoverOpen}
                placeholder="Enter image URL..."
                onSubmit={(url) => {
                  if (url) {
                    editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).insertContent({ type: 'image', attrs: { src: url } }).run();
                  }
                  setOpen(false);
                  setImagePopoverOpen(false);
                }}
              >
                {button}
              </UrlPopover>
            );
          }

          return button;
        })}
      </div>
    </div>,
    document.body,
  );
}

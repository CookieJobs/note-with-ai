import React, { useState } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Heading1, Heading2, Heading3, List, ListOrdered, Quote, Minus, CheckSquare, FileCode2, Table as TableIcon } from 'lucide-react';
import { UrlPopover } from './UrlPopover';

import { Editor } from '@tiptap/react';

export function RichTextSlashMenu({ editor }: { editor: Editor | null }) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'bottom-start' }}
      shouldShow={({ state }) => {
        const { $from, empty } = state.selection;
        const isParagraph = $from.parent.type.name === 'paragraph';
        const currentLineText = $from.parent.textContent;
        return empty && isParagraph && currentLineText === '/' && $from.parentOffset === 1;
      }}
    >
      <div className="z-50 h-auto max-h-[330px] w-64 overflow-y-auto rounded-md border border-slate-200 bg-white px-1 py-2 shadow-lg text-slate-900">
        <div className="flex flex-col space-y-1">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleHeading({ level: 1 }).run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <Heading1 className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Heading 1</p>
              <p className="text-xs text-slate-500">Big section heading.</p>
            </div>
          </button>
          
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleHeading({ level: 2 }).run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <Heading2 className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Heading 2</p>
              <p className="text-xs text-slate-500">Medium section heading.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleHeading({ level: 3 }).run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <Heading3 className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Heading 3</p>
              <p className="text-xs text-slate-500">Small section heading.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleBulletList().run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <List className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Bullet List</p>
              <p className="text-xs text-slate-500">Create a simple bulleted list.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleOrderedList().run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <ListOrdered className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Numbered List</p>
              <p className="text-xs text-slate-500">Create a list with numbering.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleBlockquote().run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <Quote className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Blockquote</p>
              <p className="text-xs text-slate-500">Capture a quote.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).setHorizontalRule().run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <Minus className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Divider</p>
              <p className="text-xs text-slate-500">Visually divide blocks.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleTaskList().run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <CheckSquare className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Task List</p>
              <p className="text-xs text-slate-500">Track tasks with a to-do list.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).toggleCodeBlock().run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <FileCode2 className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Code Block</p>
              <p className="text-xs text-slate-500">Capture a code snippet.</p>
            </div>
          </button>

          <button
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            }}
            className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
              <TableIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium">Table</p>
              <p className="text-xs text-slate-500">Insert a table.</p>
            </div>
          </button>

          <UrlPopover
            open={popoverOpen}
            onOpenChange={setPopoverOpen}
            placeholder="Enter image URL..."
            onSubmit={(url) => {
              if (url) {
                editor.chain().focus().deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }).insertContent({ type: 'image', attrs: { src: url } }).run();
              }
              setPopoverOpen(false);
            }}
          >
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setPopoverOpen(true);
              }}
              className="flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm cursor-pointer text-slate-900 hover:bg-slate-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              </div>
              <div>
                <p className="font-medium">Image</p>
                <p className="text-xs text-slate-500">Insert an image.</p>
              </div>
            </button>
          </UrlPopover>
        </div>
      </div>
    </BubbleMenu>
  );
}
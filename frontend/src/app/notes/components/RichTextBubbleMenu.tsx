import React from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, Highlighter, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { UrlPopover } from './UrlPopover';

import { Editor } from '@tiptap/react';

export function RichTextBubbleMenu({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  return (
    <BubbleMenu editor={editor} options={{ offset: 8 }} className="flex w-fit max-w-[90vw] overflow-hidden rounded-md border border-muted bg-background shadow-xl">
      <div className="flex gap-1 px-2 py-1" data-note-editor-inside="true">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Strikethrough className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleCode().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Code className="w-4 h-4" />
        </button>
        
        <UrlPopover
          defaultValue={editor.getAttributes('link').href || ''}
          placeholder="Enter link URL..."
          onSubmit={(url) => {
            if (url === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
        </UrlPopover>

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Highlighter className="w-4 h-4" />
        </button>
        <div className="w-px h-8 bg-muted mx-1" />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <AlignLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <AlignCenter className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <AlignRight className="w-4 h-4" />
        </button>
      </div>
    </BubbleMenu>
  );
}

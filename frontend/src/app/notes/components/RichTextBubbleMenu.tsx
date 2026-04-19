import React from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, Highlighter, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { UrlPopover } from './UrlPopover';

export function RichTextBubbleMenu({ editor }: { editor: any }) {
  if (!editor) return null;

  return (
    <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex w-fit max-w-[90vw] overflow-hidden rounded-md border border-muted bg-background shadow-xl">
      <div className="flex px-2 py-1 gap-1">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Strikethrough className="w-4 h-4" />
        </button>
        <button
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
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
        </UrlPopover>

        <button
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <Highlighter className="w-4 h-4" />
        </button>
        <div className="w-px h-8 bg-muted mx-1" />
        <button
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <AlignLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <AlignCenter className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted cursor-pointer"
        >
          <AlignRight className="w-4 h-4" />
        </button>
      </div>
    </BubbleMenu>
  );
}

'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Image as ImageIcon } from 'lucide-react';

type UploadOpts = {
  placeholderClassName?: string;
  maxSizeMB?: number;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ImageUploadNodeView(props: NodeViewProps) {
  const { editor, node, getPos, extension } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const opts = (extension.options || {}) as UploadOpts;
  const maxSizeBytes = (opts.maxSizeMB ?? 8) * 1024 * 1024;
  const canInteract = editor.isEditable;

  const replaceWithImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > maxSizeBytes) {
        window.alert(`图片过大（>${opts.maxSizeMB ?? 8}MB），请压缩后再上传`);
        return;
      }

      const src = await readFileAsDataUrl(file);

      editor.commands.command(({ tr, dispatch, state }) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return false;
        const image = state.schema.nodes.image?.create({ src });
        if (!image) return false;
        tr.replaceWith(pos, pos + node.nodeSize, image);
        if (dispatch) dispatch(tr);
        return true;
      });
    },
    [editor, getPos, maxSizeBytes, node.nodeSize, opts.maxSizeMB]
  );

  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      try {
        await replaceWithImage(f);
      } catch {
        // ignore
      }
    },
    [replaceWithImage]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!canInteract) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      try {
        await replaceWithImage(f);
      } catch {
        // ignore
      }
    },
    [canInteract, replaceWithImage]
  );

  const cls = useMemo(() => {
    const base = String(opts.placeholderClassName || '');
    const drag = isDragOver ? ' isDragOver' : '';
    return `${base}${drag}`.trim();
  }, [isDragOver, opts.placeholderClassName]);

  return (
    <NodeViewWrapper
      className={cls}
      data-type="image-upload"
      contentEditable={false}
      draggable={false}
      onPointerDown={(e) => {
        // 避免 ProseMirror 抢走事件导致 click/input 不稳定
        if (!canInteract) return;
        e.preventDefault();
      }}
      onClick={() => {
        if (!canInteract) return;
        inputRef.current?.click();
      }}
      onDragOver={(e) => {
        if (!canInteract) return;
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={onDrop}
      role={canInteract ? 'button' : undefined}
      tabIndex={canInteract ? 0 : undefined}
      onKeyDown={(e) => {
        if (!canInteract) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />
      <div className="imageUploadInner">
        <div className="imageUploadIcon">
          <ImageIcon size={22} />
        </div>
        <div className="imageUploadHint">拖入图片，或点击上传</div>
      </div>
    </NodeViewWrapper>
  );
}

export const ImageUpload = Node.create<UploadOpts>({
  name: 'imageUpload',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return {
      placeholderClassName: '',
      maxSizeMB: 8,
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-upload' })];
  },

  addCommands() {
    return {
      insertImageUpload:
        () =>
        ({ commands }) => {
          return commands.insertContent({ type: this.name });
        },
    } as any;
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageUploadNodeView);
  },
});



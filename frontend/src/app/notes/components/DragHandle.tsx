import React, { useEffect, useState, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { NodeSelection, Plugin, PluginKey } from 'prosemirror-state';
import { DOMSerializer } from 'prosemirror-model';

interface DragHandleProps {
  editor: Editor;
}

export const DragHandle: React.FC<DragHandleProps> = ({ editor }) => {
  const [pos, setPos] = useState({ top: 0, left: 0, visible: false });
  const currentNodeRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!editor || !editor.view) return;

    const view = editor.view;
    const scroller = view.dom.closest('[data-rich-text-editor-scroller="true"]') as HTMLElement;
    if (!scroller) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      let checkX = event.clientX;
      const editorRect = view.dom.getBoundingClientRect();
      // If mouse is to the left of the actual text content (inside padding or margin)
      // Force the X coordinate to be inside the editor to ensure we hit the text block at this Y coordinate
      if (checkX < editorRect.left + 30) {
        checkX = editorRect.left + 30;
      }

      // Find the proseMirror node at the adjusted coords
      const result = view.posAtCoords({ left: checkX, top: event.clientY });
      if (!result) {
        return;
      }

      // Find the block node
      const resolvedPos = view.state.doc.resolve(result.pos);
      // We want to find the top-level block node
      const depth = resolvedPos.depth;
      let blockNodePos = -1;
      for (let i = depth; i >= 0; i--) {
        const node = resolvedPos.node(i);
        if (node.type.isBlock && i === 1) {
          blockNodePos = resolvedPos.before(i);
          break;
        }
      }

      if (blockNodePos === -1) {
        setPos(p => ({ ...p, visible: false }));
        return;
      }

      const domNode = view.nodeDOM(blockNodePos);
      if (domNode && domNode instanceof HTMLElement) {
        currentNodeRef.current = blockNodePos;
        const rect = domNode.getBoundingClientRect();
        
        // Find the nearest positioned container to calculate absolute top/left
        // In our case, the editor container should be position: relative
        const scrollerRect = scroller.getBoundingClientRect();
        
        // When absolutely positioned inside a scroll container,
        // top is relative to the scrolled content
        setPos({
          top: rect.top - scrollerRect.top + scroller.scrollTop,
          left: rect.left - scrollerRect.left - 24, // Place it exactly 24px to the left of the actual block node
          visible: true
        });
      }
    };

    const handleMouseLeave = (event: MouseEvent) => {
      const related = event.relatedTarget as HTMLElement;
      if (related && related.closest('.custom-drag-handle')) {
        return;
      }
      // Delay hiding to allow mouse to travel to the handle
      hideTimeoutRef.current = setTimeout(() => {
        setPos(p => ({ ...p, visible: false }));
      }, 50);
    };

    const handleScroll = () => {
      setPos(p => ({ ...p, visible: false }));
    };

    const handleKeyDown = () => {
      setPos(p => ({ ...p, visible: false }));
    };

    scroller.addEventListener('mousemove', handleMouseMove);
    scroller.addEventListener('mouseleave', handleMouseLeave);
    scroller.addEventListener('scroll', handleScroll);
    view.dom.addEventListener('keydown', handleKeyDown);

    return () => {
      scroller.removeEventListener('mousemove', handleMouseMove);
      scroller.removeEventListener('mouseleave', handleMouseLeave);
      scroller.removeEventListener('scroll', handleScroll);
      view.dom.removeEventListener('keydown', handleKeyDown);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [editor]);

  const handleDragStart = (e: React.DragEvent) => {
    if (currentNodeRef.current === null) return;
    
    const view = editor.view;
    const pos = currentNodeRef.current;
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;

    // Set selection to the node
    const selection = NodeSelection.create(view.state.doc, pos);
    const tr = view.state.tr.setSelection(selection);
    view.dispatch(tr);

    // Prepare dataTransfer
    const slice = selection.content();
    const serializer = DOMSerializer.fromSchema(view.state.schema);
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(serializer.serializeFragment(slice.content));

    e.dataTransfer.clearData();
    e.dataTransfer.setData('text/html', tempDiv.innerHTML);
    e.dataTransfer.setData('text/plain', node.textContent || '');
    e.dataTransfer.effectAllowed = 'copyMove';

    // Set drag image
    const dragImage = view.nodeDOM(pos) as HTMLElement;
    if (dragImage) {
      e.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  };

  if (!pos.visible) return null;

  return (
    <div
      className="custom-drag-handle"
      draggable
      onDragStart={handleDragStart}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        width: '32px', // wider to bridge the gap
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start', // icon on the left
        paddingLeft: '4px',
        cursor: 'grab',
        opacity: 0.5,
        zIndex: 50,
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <circle cx="9" cy="5" r="1.5"></circle>
        <circle cx="9" cy="12" r="1.5"></circle>
        <circle cx="9" cy="19" r="1.5"></circle>
        <circle cx="15" cy="5" r="1.5"></circle>
        <circle cx="15" cy="12" r="1.5"></circle>
        <circle cx="15" cy="19" r="1.5"></circle>
      </svg>
    </div>
  );
};

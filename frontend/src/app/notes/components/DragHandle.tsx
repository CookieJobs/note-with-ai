import React, { useEffect, useState, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { NodeSelection } from 'prosemirror-state';
import { DOMSerializer } from 'prosemirror-model';

interface DragHandleProps {
  editor: Editor;
}

type ProseMirrorDraggingState = {
  slice: ReturnType<NodeSelection['content']>;
  move: boolean;
  node?: NodeSelection;
};

const HANDLE_WIDTH = 32;
const HANDLE_HEIGHT = 24;
const HANDLE_GUTTER = 8;

export const DragHandle: React.FC<DragHandleProps> = ({ editor }) => {
  const [pos, setPos] = useState({ top: 0, left: 0, visible: false });
  const currentNodeRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHandleHoveredRef = useRef(false);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!editor || !editor.view) return;

    const view = editor.view;
    const scroller = view.dom.closest('[data-rich-text-editor-scroller="true"]') as HTMLElement;
    if (!scroller) return;

    const hideHandle = () => {
      if (isHandleHoveredRef.current) return;
      setPos(p => ({ ...p, visible: false }));
    };

    const updateHandlePosition = (event: Pick<MouseEvent, 'clientX' | 'clientY'>) => {
      latestPointerRef.current = { x: event.clientX, y: event.clientY };

      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      const editorRect = view.dom.getBoundingClientRect();
      const withinHorizontalBounds =
        event.clientX >= editorRect.left - HANDLE_WIDTH - HANDLE_GUTTER &&
        event.clientX <= editorRect.right;

      if (!withinHorizontalBounds) {
        hideHandle();
        return;
      }

      // Use the real pointer position, only clamping it to the editor box.
      // This keeps the trigger area aligned with the visible row instead of
      // forcing a deep hit inside the text content.
      const lookupX = Math.min(Math.max(event.clientX, editorRect.left + 1), editorRect.right - 1);
      const result = view.posAtCoords({ left: lookupX, top: event.clientY });
      if (!result) {
        hideHandle();
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
        hideHandle();
        return;
      }

      const domNode = view.nodeDOM(blockNodePos);
      if (domNode && domNode instanceof HTMLElement) {
        const rect = domNode.getBoundingClientRect();
        const withinRowBounds =
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom &&
          event.clientX >= rect.left - HANDLE_WIDTH - HANDLE_GUTTER &&
          event.clientX <= rect.right;

        if (!withinRowBounds) {
          hideHandle();
          return;
        }

        currentNodeRef.current = blockNodePos;
        const scrollerRect = scroller.getBoundingClientRect();

        setPos({
          top: rect.top - scrollerRect.top + scroller.scrollTop + Math.max((rect.height - HANDLE_HEIGHT) / 2, 0),
          left: rect.left - scrollerRect.left - HANDLE_WIDTH + HANDLE_GUTTER,
          visible: true
        });
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      updateHandlePosition(event);
    };

    const handleMouseLeave = (event: MouseEvent) => {
      const related = event.relatedTarget as HTMLElement;
      if (related && related.closest('.custom-drag-handle')) {
        return;
      }
      hideTimeoutRef.current = setTimeout(() => {
        hideHandle();
      }, 50);
    };

    const handleScroll = () => {
      hideHandle();
    };

    const handleKeyDown = () => {
      hideHandle();
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
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.dropEffect = 'move';

    // Dragging starts from a custom overlay element, so ProseMirror's built-in
    // dragstart handler never runs. We must set the internal dragging state
    // ourselves so the subsequent drop is treated as a move instead of a copy.
    (view as typeof view & { dragging?: ProseMirrorDraggingState }).dragging = {
      slice,
      move: true,
      node: selection,
    };

    // Set drag image
    const dragImage = view.nodeDOM(pos) as HTMLElement;
    if (dragImage) {
      e.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  };

  const handleMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    isHandleHoveredRef.current = true;
    setPos(p => ({ ...p, visible: true }));
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleMouseLeave = () => {
    isHandleHoveredRef.current = false;
    const pointer = latestPointerRef.current;
    if (!pointer) {
      setPos(p => ({ ...p, visible: false }));
      return;
    }

    const view = editor.view;
    const result = view.posAtCoords({ left: Math.max(pointer.x, 0), top: pointer.y });
    if (!result) {
      setPos(p => ({ ...p, visible: false }));
      return;
    }

    const domNode = view.nodeDOM(currentNodeRef.current ?? result.pos);
    if (!(domNode instanceof HTMLElement)) {
      setPos(p => ({ ...p, visible: false }));
      return;
    }

    const rect = domNode.getBoundingClientRect();
    const stillWithinRow =
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom &&
      pointer.x >= rect.left - HANDLE_WIDTH - HANDLE_GUTTER &&
      pointer.x <= rect.right;

    setPos(p => ({ ...p, visible: stillWithinRow }));
  };

  if (!pos.visible) return null;

  return (
    <div
      className="custom-drag-handle"
      draggable
      onDragStart={handleDragStart}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        width: `${HANDLE_WIDTH}px`,
        height: `${HANDLE_HEIGHT}px`,
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

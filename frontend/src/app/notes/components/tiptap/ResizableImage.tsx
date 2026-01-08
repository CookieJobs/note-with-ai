'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

type ImageAttrs = {
  src: string;
  alt?: string | null;
  title?: string | null;
  width?: number | null;
  height?: number | null;
};

type Opts = {
  wrapperClassName?: string;
  imgClassName?: string;
  minWidth?: number;
  selectedClassName?: string;
  editableClassName?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getEditorContentWidth(fromEl: HTMLElement | null): number | null {
  // ProseMirror 节点是 TipTap 默认的 content 容器
  const root = fromEl?.closest('.ProseMirror') as HTMLElement | null;
  if (!root) return null;
  const w = root.clientWidth;
  return w > 0 ? w : null;
}

function ResizableImageNodeView(props: NodeViewProps) {
  const { editor, node, getPos, selected } = props;
  const attrs = node.attrs as ImageAttrs;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const canInteract = editor.isEditable;
  const minW = 80;
  const minWidth = Math.max(minW, (editor.extensionManager.extensions.find((e) => e.name === 'image') as any)?.options?.minWidth ?? 80);

  const ratioRef = useRef<number | null>(null);
  const didAutoFitRef = useRef(false);

  const [showModal, setShowModal] = useState(false);
  const [lockRatio, setLockRatio] = useState(true);
  const [draftW, setDraftW] = useState<string>('');
  const [draftH, setDraftH] = useState<string>('');

  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    corner: 'se' | 'sw' | 'ne' | 'nw';
  } | null>(null);

  const commitSize = useCallback(
    (nextW: number, nextH: number) => {
      editor.commands.command(({ tr, dispatch }) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return false;
        const newAttrs = { ...attrs, width: Math.round(nextW), height: Math.round(nextH) };
        tr.setNodeMarkup(pos, undefined, newAttrs);
        if (dispatch) dispatch(tr);
        return true;
      });
    },
    [attrs, editor.commands, getPos]
  );

  // 首次加载：自动等比缩放到“尽量 fit 编辑器宽度”（不放大，只缩小）
  useEffect(() => {
    if (!canInteract) return; // 只在编辑态做 auto-fit（展示态直接 max-width 即可）
    if (didAutoFitRef.current) return;
    if (attrs.width && attrs.height) {
      didAutoFitRef.current = true;
      return;
    }

    const img = imgRef.current;
    if (!img) return;

    const tryFit = () => {
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if (!nw || !nh) return;

      ratioRef.current = nw / nh;

      const cw = getEditorContentWidth(img);
      if (!cw) return;
      const safeCw = Math.max(0, cw - 8); // 预留一点安全空间，避免出现横向滚动条

      const targetW = Math.min(nw, safeCw); // 不放大
      const targetH = targetW / (ratioRef.current || (nw / nh));

      // 只有“需要缩小”或“没有任何尺寸”时才写入 attrs
      if (!attrs.width || !attrs.height || nw > safeCw) {
        commitSize(targetW, targetH);
      }

      didAutoFitRef.current = true;
    };

    if (img.complete) tryFit();
    else img.addEventListener('load', tryFit, { once: true });
  }, [attrs.height, attrs.width, canInteract, commitSize]);

  const style = useMemo<React.CSSProperties>(() => {
    const w = typeof attrs.width === 'number' && attrs.width > 0 ? attrs.width : undefined;
    const h = typeof attrs.height === 'number' && attrs.height > 0 ? attrs.height : undefined;

    return {
      width: w ? `${w}px` : '100%',
      maxWidth: '100%',
      height: h ? `${h}px` : 'auto',
    };
  }, [attrs.height, attrs.width]);

  const startResize = useCallback(
    (corner: 'se' | 'sw' | 'ne' | 'nw') => (e: React.PointerEvent) => {
      if (!canInteract) return;
      e.preventDefault();
      e.stopPropagation();

      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const startW = rect.width;
      const startH = rect.height;

      const r = ratioRef.current ?? (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null);
      ratioRef.current = r;

      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
        corner,
      };
      setResizing(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [canInteract]
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (!canInteract) return;
      if (!resizing) return;
      const st = resizeRef.current;
      if (!st) return;

      const dx = e.clientX - st.startX;
      // const dy = e.clientY - st.startY; // 保持比例时不需要

      // 保持比例：以“水平变化”为主（体验更稳定）
      const signX = st.corner.includes('w') ? -1 : 1;
      const nextWRaw = st.startW + dx * signX;

      const cw = getEditorContentWidth(imgRef.current);
      const maxW = cw ? Math.max(minWidth, cw - 8) : Number.POSITIVE_INFINITY;
      const nextW = clamp(nextWRaw, minWidth, maxW);

      const r = ratioRef.current || (st.startW / st.startH);
      const nextH = nextW / r;

      // 直接改 DOM 样式实现“拖拽过程实时反馈”（结束再写入 attrs）
      if (imgRef.current) {
        imgRef.current.style.width = `${nextW}px`;
        imgRef.current.style.height = `${nextH}px`;
      }
    },
    [canInteract, minWidth, resizing]
  );

  const onEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!canInteract) return;
      if (!resizing) return;
      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      // 还原为由 attrs 控制（并写回 attrs）
      img.style.width = '';
      img.style.height = '';

      commitSize(rect.width, rect.height);
      resizeRef.current = null;
      setResizing(false);
    },
    [canInteract, commitSize, resizing]
  );

  const openModal = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    setDraftW(String(w));
    setDraftH(String(h));
    // 默认锁比例
    setLockRatio(true);
    ratioRef.current = ratioRef.current ?? (w > 0 && h > 0 ? w / h : null);
    setShowModal(true);
  }, []);

  useEffect(() => {
    if (!showModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showModal]);

  const applyModal = useCallback(() => {
    const w0 = Number(draftW);
    const h0 = Number(draftH);
    if (!Number.isFinite(w0) || !Number.isFinite(h0) || w0 <= 0 || h0 <= 0) {
      setShowModal(false);
      return;
    }
    const cw = getEditorContentWidth(imgRef.current);
    const maxW = cw ? Math.max(minWidth, cw - 8) : Number.POSITIVE_INFINITY;
    const r = ratioRef.current ?? (w0 / h0);

    let w = clamp(w0, minWidth, maxW);
    let h = h0;

    if (lockRatio) {
      h = w / r;
    } else {
      // 不锁比例：也需要防御性限制宽度
      h = h0;
    }

    commitSize(w, h);
    setShowModal(false);
  }, [commitSize, draftH, draftW, lockRatio, minWidth]);

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={[
        (editor.extensionManager.extensions.find((e) => e.name === 'image') as any)?.options?.wrapperClassName || '',
        canInteract ? (editor.extensionManager.extensions.find((e) => e.name === 'image') as any)?.options?.editableClassName || '' : '',
        selected ? (editor.extensionManager.extensions.find((e) => e.name === 'image') as any)?.options?.selectedClassName || '' : '',
      ].join(' ').trim()}
      data-type="resizable-image"
      draggable={false}
    >
      <div
        className="imgFrame"
        onDoubleClick={(e) => {
          if (!canInteract) return;
          e.preventDefault();
          e.stopPropagation();
          openModal();
        }}
      >
        <img ref={imgRef} src={attrs.src} alt={attrs.alt ?? ''} title={attrs.title ?? ''} style={style} />
        {canInteract && selected && (
          <>
            <div className="resizeHandle nw" onPointerDown={startResize('nw')} onPointerMove={onMove} onPointerUp={onEnd} />
            <div className="resizeHandle ne" onPointerDown={startResize('ne')} onPointerMove={onMove} onPointerUp={onEnd} />
            <div className="resizeHandle sw" onPointerDown={startResize('sw')} onPointerMove={onMove} onPointerUp={onEnd} />
            <div className="resizeHandle se" onPointerDown={startResize('se')} onPointerMove={onMove} onPointerUp={onEnd} />
          </>
        )}
      </div>

      {showModal && (
        <div
          className="imageSizeModalOverlay"
          onMouseDown={(e) => {
            // 点击遮罩关闭
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div className="imageSizeModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="imageSizeModalTitle">图片尺寸</div>
            <div className="imageSizeModalRow">
              <label>
                <span>宽</span>
                <input
                  inputMode="numeric"
                  value={draftW}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, '');
                    setDraftW(v);
                    if (lockRatio) {
                      const w = Number(v);
                      const r = ratioRef.current;
                      if (r && Number.isFinite(w) && w > 0) setDraftH(String(Math.round(w / r)));
                    }
                  }}
                />
              </label>
              <label>
                <span>高</span>
                <input
                  inputMode="numeric"
                  value={draftH}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, '');
                    setDraftH(v);
                    if (lockRatio) {
                      const h = Number(v);
                      const r = ratioRef.current;
                      if (r && Number.isFinite(h) && h > 0) setDraftW(String(Math.round(h * r)));
                    }
                  }}
                  disabled={lockRatio}
                />
              </label>
            </div>
            <label className="imageSizeModalCheck">
              <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
              <span>锁定图片比例</span>
            </label>
            <div className="imageSizeModalActions">
              <button type="button" className="btnCancel" onClick={() => setShowModal(false)}>
                取消
              </button>
              <button type="button" className="btnOk" onClick={applyModal}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ResizableImage = Node.create<Opts>({
  name: 'image', // 关键：用同名 image，兼容旧 JSON
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return {
      wrapperClassName: '',
      imgClassName: '',
      minWidth: 80,
      selectedClassName: '',
      editableClassName: '',
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // 只输出 img，尺寸通过 attrs 写在 style 里（max-width 交给 CSS）
    const { width, height, ...rest } = HTMLAttributes as any;
    const styleParts: string[] = [];
    if (width) styleParts.push(`width:${Number(width)}px`);
    if (height) styleParts.push(`height:${Number(height)}px`);
    const style = styleParts.join(';');
    return ['img', mergeAttributes(rest, style ? { style } : {})];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageNodeView);
  },
});



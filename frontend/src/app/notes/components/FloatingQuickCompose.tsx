'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import composeStyles from '../styles/floating-compose.module.scss';
import { focusProseMirrorWithin } from './focusProseMirror';

function EditorLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="h-5 w-5 animate-spin rounded-full border-[3px] border-gray-200 border-t-gray-400" />
    </div>
  );
}

const RichTextEditorPromise = import('./RichTextEditor');
const RichTextEditor = dynamic(() => RichTextEditorPromise, {
  ssr: false,
  loading: () => <EditorLoadingPlaceholder />,
});

import { JSONContent } from '@tiptap/react';

type FloatingQuickComposeProps = {
  valueJson: JSONContent | null;
  valueText: string;
  onChange: (next: { json: JSONContent; text: string }) => void;
  onSubmit: () => void;
  onCancel: () => void;
  loading?: boolean;
};

export default function FloatingQuickCompose({
  valueJson,
  valueText,
  onChange,
  onSubmit,
  onCancel,
  loading = false,
}: FloatingQuickComposeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const expandedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const t = e.target as Node | null;
      if (!t) return;
      if (root.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return focusProseMirrorWithin(expandedRef.current);
  }, [open]);

  const disabled = loading;
  const canSubmit = !disabled && (valueText || '').trim().length > 0;
  const hasDraft = (valueText || '').trim().length > 0;
  const shellTransition = {
    type: 'spring',
    stiffness: 200,
    damping: 25,
    mass: 0.8,
  } as const;

  const contentTransition = {
    duration: 0.2,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  const contentEnterTransition = {
    duration: 0.2,
    delay: 0.05,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  const submitAndClose = () => {
    if (!canSubmit) return;
    setOpen(false);
    onSubmit();
  };

  const handleCancel = () => {
    onCancel();
    setOpen(false);
  };

  const renderContent = () => {
    const state = open ? 'expanded' : 'collapsed';

    return (
      <motion.div
        ref={rootRef}
        layout
        data-state={state}
        className={`${composeStyles.floatingComposeShell}`}
        transition={shellTransition}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {state === 'collapsed' && (
            <motion.button
              key="collapsed"
              type="button"
              className={`${composeStyles.floatingComposeBarInner} w-full`}
              onClick={() => setOpen(true)}
              aria-label="打开快速记录"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={contentTransition}
            >
              <motion.span
                className={composeStyles.floatingComposeBarText}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={contentTransition}
              >
                {hasDraft ? '继续编辑草稿…' : '发送消息...'}
              </motion.span>
              {hasDraft && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={contentTransition}
                  className={`${composeStyles.floatingComposeDraftDot} absolute right-4`}
                  aria-label="有草稿"
                  title="有草稿"
                />
              )}
            </motion.button>
          )}

          {state === 'expanded' && (
            <motion.div
              key="expanded"
              ref={expandedRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={contentTransition}
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={contentEnterTransition}
                className={composeStyles.floatingComposeEditor}
              >
                <RichTextEditor
                  value={valueJson}
                  onChange={onChange}
                  placeholder="此刻的想法、待办或总结..."
                  showToolbar
                  autoFocus="end"
                  toolbarVariant="advanced"
                  onModEnter={() => {
                    submitAndClose();
                  }}
                  className="text-gray-900 !mx-auto"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={contentEnterTransition}
                className={composeStyles.floatingComposeActions}
              >
                <div className={composeStyles.floatingComposeHint}>Cmd/Ctrl + Enter 保存</div>
                <button
                  type="button"
                  className={composeStyles.composeCancelBtn}
                  onClick={handleCancel}
                  disabled={disabled}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={composeStyles.composeSaveBtn}
                  onClick={submitAndClose}
                  disabled={!canSubmit}
                >
                  {loading ? '保存中...' : '保存'}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return renderContent();
}

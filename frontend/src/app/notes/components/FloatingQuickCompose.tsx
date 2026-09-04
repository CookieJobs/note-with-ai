'use client';

import dynamic from 'next/dynamic';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import composeStyles from '../styles/floating-compose.module.scss';
import { focusProseMirrorWithin } from './focusProseMirror';
import { flomoEditorChromeProps } from './richTextEditorPresets';
import { loadRichTextEditor } from './richTextEditorLoader';
import type { QuickCaptureContext } from '../hooks/useQuickCaptureDraft';

function EditorLoadingPlaceholder() {
  return (
    <div className="space-y-3 py-2">
      <div className="h-4 w-5/6 animate-pulse rounded-full bg-gray-100" />
      <div className="h-4 w-2/3 animate-pulse rounded-full bg-gray-100" />
    </div>
  );
}

const RichTextEditor = dynamic(loadRichTextEditor, {
  ssr: false,
  loading: () => <EditorLoadingPlaceholder />,
});

import { JSONContent } from '@tiptap/react';

type FloatingQuickComposeProps = {
  open: boolean;
  valueJson: JSONContent | null;
  valueText: string;
  onOpen: () => void;
  onChange: (next: { json: JSONContent; text: string }) => void;
  onSubmit: () => void;
  onCancel: () => void;
  loading?: boolean;
  context?: QuickCaptureContext;
  onClearContext?: () => void;
  onDiscardDraft?: () => void;
};

type ShellPhase = 'collapsed' | 'expanded' | 'closing';

export default function FloatingQuickCompose({
  open,
  valueJson,
  valueText,
  onOpen,
  onChange,
  onSubmit,
  onCancel,
  loading = false,
  context,
  onClearContext,
  onDiscardDraft,
}: FloatingQuickComposeProps) {
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const [shellPhase, setShellPhase] = useState<ShellPhase>(open ? 'expanded' : 'collapsed');
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    const restoreFocus = focusProseMirrorWithin(expandedRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocus?.();
    };
  }, [onCancel, open]);

  useLayoutEffect(() => {
    if (open) {
      setShellPhase('expanded');
      return;
    }

    setShellPhase((current) => (current === 'expanded' ? 'closing' : current));
  }, [open]);

  const disabled = loading;
  const canSubmit = !disabled && (valueText || '').trim().length > 0;
  const hasDraft = (valueText || '').trim().length > 0;
  const isClosing = shellPhase === 'closing';
  const shellExpanded = shellPhase !== 'collapsed';
  const shellLayoutTransition = {
    type: 'tween',
    duration: 0.16,
    ease: [0.2, 0.9, 0.2, 1] as const,
  } as const;
  const shellVisualTransition = {
    duration: 0.14,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const collapsedTransition = {
    duration: 0.09,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const panelTransition = {
    duration: 0.12,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const closingPanelTransition = {
    duration: 0.12,
    ease: [0.4, 0, 0.2, 1] as const,
  };

  const editorTransition = {
    duration: 0.12,
    delay: 0,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const actionsTransition = {
    duration: 0.1,
    delay: 0.01,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const submitAndClose = () => {
    if (!canSubmit) return;
    onSubmit();
  };

  const handleCancel = () => {
    onCancel();
  };

  const renderContent = () => {
    return (
      <motion.div
        layout
        data-state={shellExpanded ? 'expanded' : 'collapsed'}
        className={`${composeStyles.floatingComposeShell}`}
        initial={false}
        animate={{
          borderRadius: shellExpanded ? 20 : 12,
          minHeight: shellPhase === 'expanded' ? 156 : 54,
          paddingTop: shellPhase === 'expanded' ? 20 : 14,
          paddingRight: 24,
          paddingBottom: shellPhase === 'expanded' ? 20 : 14,
          paddingLeft: 24,
          borderColor: shellExpanded ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 0, 0, 0.04)',
          boxShadow: shellExpanded
              ? '0 1px 3px rgba(0, 0, 0, 0.04), 0 6px 18px rgba(0, 0, 0, 0.045)'
              : '0 1px 3px rgba(0, 0, 0, 0.04), 0 3px 10px rgba(0, 0, 0, 0.035)',
        }}
        transition={{
          layout: shellLayoutTransition,
          borderRadius: shellVisualTransition,
          minHeight: shellVisualTransition,
          paddingTop: shellVisualTransition,
          paddingBottom: shellVisualTransition,
          borderColor: shellVisualTransition,
          boxShadow: shellVisualTransition,
        }}
      >
        <AnimatePresence initial={false} mode="wait">
          {shellPhase === 'collapsed' && (
            <motion.button
              key="collapsed"
              type="button"
              className={`${composeStyles.floatingComposeBarInner} w-full`}
              onClick={onOpen}
              aria-label="打开快速记录"
                initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={collapsedTransition}
            >
              <motion.span
                className={composeStyles.floatingComposeBarText}
                  initial={{ opacity: 0, y: 1 }}
                animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -1 }}
                transition={collapsedTransition}
              >
                {hasDraft ? '继续编辑草稿…' : '记下这一刻'}
              </motion.span>
              {hasDraft && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={collapsedTransition}
                  className={`${composeStyles.floatingComposeDraftDot} absolute right-4`}
                  aria-label="有草稿"
                  title="有草稿"
                />
              )}
            </motion.button>
          )}

          {shellExpanded && (
            <motion.div
              key="expanded"
              ref={expandedRef}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 1, y: 0 }}
              transition={panelTransition}
              className={composeStyles.floatingComposeExpanded}
            >
              <AnimatePresence
                initial={false}
                onExitComplete={() => {
                  if (!open) {
                    setShellPhase((current) => (current === 'closing' ? 'collapsed' : current));
                  }
                }}
              >
                {open && (
                  <motion.div
                    key="expanded-body"
                    className={composeStyles.floatingComposeBody}
                    initial={{ opacity: 0, height: 0, y: 3 }}
                    animate={{
                      opacity: 1,
                      height: 'auto',
                      y: 0,
                      transition: {
                        height: panelTransition,
                        opacity: panelTransition,
                        y: panelTransition,
                      },
                    }}
                    exit={{
                      opacity: 0,
                      height: 0,
                      y: -2,
                      transition: {
                        height: closingPanelTransition,
                        opacity: { duration: 0.1, ease: [0.4, 0, 1, 1] as const },
                        y: { duration: 0.1, ease: [0.4, 0, 1, 1] as const },
                      },
                    }}
                  >
                    <motion.div
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={editorTransition}
                      className={composeStyles.floatingComposeEditor}
                    >
                      {context && <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">正在延续两条过去的记录 <button type="button" className="ml-2 underline" onClick={onClearContext}>移除说明</button></div>}
                      <RichTextEditor
                        value={valueJson}
                        onChange={onChange}
                        placeholder="此刻的想法、待办或总结..."
                        showToolbar={showMore}
                        autoFocus="end"
                        toolbarVariant="advanced"
                          {...flomoEditorChromeProps}
                        onModEnter={() => {
                          submitAndClose();
                        }}
                        className="text-gray-900 !mx-auto"
                      />
                      <button type="button" className="mt-2 min-h-11 text-left text-xs text-gray-500 underline" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore}>
                        {showMore ? '收起格式' : '更多格式'}
                      </button>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{
                        opacity: isClosing ? 0 : 1,
                        y: isClosing ? -2 : 0,
                      }}
                      transition={isClosing ? closingPanelTransition : actionsTransition}
                      className={composeStyles.floatingComposeActions}
                    >
                      <div className={composeStyles.floatingComposeHint}>Cmd/Ctrl + Enter 保存</div>
                      {hasDraft && <button type="button" className="min-h-11 px-2 text-xs text-gray-500 underline" onClick={onDiscardDraft}>放弃草稿</button>}
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
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return renderContent();
}

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import composeStyles from '../styles/floating-compose.module.scss';
import { focusProseMirrorWithin } from './focusProseMirror';
import { flomoEditorChromeProps } from './richTextEditorPresets';
import { loadRichTextEditor } from './richTextEditorLoader';

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
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  onDiscard: () => void;
  loading?: boolean;
  saveFailed?: boolean;
  status?: string;
  statusIsError?: boolean;
};

type ShellPhase = 'collapsed' | 'expanded' | 'closing';

export default function FloatingQuickCompose({
  open,
  valueJson,
  valueText,
  onOpen,
  onChange,
  onSubmit,
  onClose,
  onDiscard,
  loading = false,
  saveFailed = false,
  status = '',
  statusIsError = false,
}: FloatingQuickComposeProps) {
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [shellPhase, setShellPhase] = useState<ShellPhase>(open ? 'expanded' : 'collapsed');

  useEffect(() => {
    if (!open) return;
    return focusProseMirrorWithin(expandedRef.current);
  }, [open]);

  useLayoutEffect(() => {
    if (open) {
      setShellPhase('expanded');
      return;
    }

    returnFocusRef.current = Boolean(expandedRef.current?.contains(document.activeElement));
    setConfirmDiscard(false);
    setShellPhase((current) => (current === 'expanded' ? 'closing' : current));
  }, [open]);

  useEffect(() => {
    if (shellPhase === 'collapsed' && returnFocusRef.current) {
      triggerRef.current?.focus({ preventScroll: true });
      returnFocusRef.current = false;
    }
  }, [shellPhase]);

  const disabled = loading;
  const canSubmit = !disabled && !confirmDiscard && (valueText || '').trim().length > 0;
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

  const submit = () => {
    if (!canSubmit) return;
    void onSubmit();
  };

  const renderContent = () => {
    return (
      <>
      <motion.div
        layout
        data-state={shellExpanded ? 'expanded' : 'collapsed'}
        className={`${composeStyles.floatingComposeShell}`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          if (confirmDiscard) setConfirmDiscard(false);
          else onClose();
        }}
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
              ref={triggerRef}
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
                {hasDraft ? '继续编辑草稿…' : '记下这一刻…'}
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
                      <RichTextEditor
                        value={valueJson}
                        onChange={onChange}
                        placeholder="此刻的想法、待办或总结..."
                        showToolbar
                        autoFocus="end"
                        toolbarVariant="advanced"
                          {...flomoEditorChromeProps}
                        onModEnter={() => {
                          submit();
                        }}
                        className="text-gray-900 !mx-auto"
                      />
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
                      {hasDraft && <button
                        type="button"
                        className={composeStyles.composeDiscardBtn}
                        onClick={() => setConfirmDiscard(true)}
                        disabled={disabled || confirmDiscard}
                      >放弃草稿</button>}
                      <button
                        type="button"
                        className={composeStyles.composeCancelBtn}
                        onClick={onClose}
                      >
                        收起
                      </button>
                      <button
                        type="button"
                        className={composeStyles.composeSaveBtn}
                        onClick={submit}
                        disabled={!canSubmit}
                      >
                        {loading ? '保存中…' : saveFailed ? '重试保存' : '保存'}
                      </button>
                    </motion.div>
                    {confirmDiscard && <div className={composeStyles.discardConfirmation} role="group" aria-label="放弃草稿确认">
                      <p>放弃这份尚未保存的草稿？此操作无法撤销。</p>
                      <div>
                        <button type="button" autoFocus className={composeStyles.composeCancelBtn} onClick={() => setConfirmDiscard(false)}>保留草稿</button>
                        <button type="button" className={composeStyles.composeDiscardBtn} onClick={() => { setConfirmDiscard(false); onDiscard(); }}>确认放弃</button>
                      </div>
                    </div>}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      {status && <p className={`${composeStyles.captureStatus} ${statusIsError ? composeStyles.captureStatusError : ''}`} role={statusIsError ? 'alert' : 'status'}>{status}</p>}
      </>
    );
  };

  return renderContent();
}

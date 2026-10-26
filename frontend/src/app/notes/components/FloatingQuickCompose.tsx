'use client';

import dynamic from 'next/dynamic';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PencilLine, Plus } from 'lucide-react';
import composeStyles from '../styles/floating-compose.module.scss';
import { focusProseMirrorWithin } from './focusProseMirror';
import { flomoEditorChromeProps } from './richTextEditorPresets';
import { loadRichTextEditor } from './richTextEditorLoader';
import NoteTitleField from './NoteTitleField';
import { hasTitleSourceText } from '../utils/titleValidation';

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
import { useNoteTitleSuggestion } from '../../../hooks/useNoteTitleSuggestion';

type FloatingQuickComposeProps = {
  open: boolean;
  valueJson: JSONContent | null;
  valueText: string;
  title: string;
  userId: string | null;
  onRegisterInvalidate?: (invalidate: () => void) => () => void;
  onTitleChange: (title: string) => void;
  onOpen: () => void;
  onChange: (next: { json: JSONContent; text: string }) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  status?: string;
};

type ShellPhase = 'collapsed' | 'expanded' | 'closing';

export default function FloatingQuickCompose({
  open,
  valueJson,
  valueText,
  title,
  userId,
  onRegisterInvalidate,
  onTitleChange,
  onOpen,
  onChange,
  onSubmit,
  onCancel,
  loading = false,
  status = '',
}: FloatingQuickComposeProps) {
  const reduceMotion = useReducedMotion();
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const restoreCaptureFocus = useRef(false);
  const [shellPhase, setShellPhase] = useState<ShellPhase>(open ? 'expanded' : 'collapsed');
  const suggestion = useNoteTitleSuggestion({
    userId, editorSessionId: 'quick-compose', open,
    getBody: () => valueJson ? { kind: 'rich-text', document: valueJson as Record<string, unknown> } : { kind: 'plain-text', text: valueText },
    getTitle: () => title,
    onApply: onTitleChange,
  });
  useEffect(() => onRegisterInvalidate?.(suggestion.invalidate), [onRegisterInvalidate, suggestion.invalidate]);

  useEffect(() => {
    if (!open) return;
    restoreCaptureFocus.current = false;
    return focusProseMirrorWithin(expandedRef.current);
  }, [open]);

  useLayoutEffect(() => {
    if (open) {
      setShellPhase('expanded');
      return;
    }

    setShellPhase((current) => (current === 'expanded' ? 'closing' : current));
  }, [open]);

  const disabled = loading;
  const canSubmit = !disabled && (valueText || '').trim().length > 0;
  const hasDraft = Boolean((valueText || '').trim() || title.trim());
  const isClosing = shellPhase === 'closing';
  const shellExpanded = shellPhase !== 'collapsed';
  const shellLayoutTransition = {
    type: 'tween',
    duration: reduceMotion ? 0 : 0.16,
    ease: [0.2, 0.9, 0.2, 1] as const,
  } as const;
  const shellVisualTransition = {
    duration: reduceMotion ? 0 : 0.14,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const collapsedTransition = {
    duration: reduceMotion ? 0 : 0.09,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const panelTransition = {
    duration: reduceMotion ? 0 : 0.12,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const closingPanelTransition = {
    duration: reduceMotion ? 0 : 0.12,
    ease: [0.4, 0, 0.2, 1] as const,
  };

  const editorTransition = {
    duration: reduceMotion ? 0 : 0.12,
    delay: 0,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const actionsTransition = {
    duration: reduceMotion ? 0 : 0.1,
    delay: reduceMotion ? 0 : 0.01,
    ease: [0.2, 0.9, 0.2, 1] as const,
  };

  const submitAndClose = () => {
    if (!canSubmit) return;
    suggestion.invalidate();
    onSubmit();
  };

  const handleCancel = () => {
    restoreCaptureFocus.current = true;
    suggestion.invalidate();
    onCancel();
  };

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) submitAndClose();
      else focusProseMirrorWithin(expandedRef.current);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancel();
    }
  };

  const renderContent = () => {
    return (
      <motion.div
        layout
        data-state={shellExpanded ? 'expanded' : 'collapsed'}
        className={`${composeStyles.floatingComposeShell}`}
        initial={false}
        animate={{
          borderRadius: 14,
          minHeight: shellPhase === 'expanded' ? 156 : 76,
          paddingTop: shellPhase === 'expanded' ? 20 : 16,
          paddingRight: 24,
          paddingBottom: shellPhase === 'expanded' ? 20 : 16,
          paddingLeft: 24,
          borderColor: shellExpanded ? '#b9cbed' : '#dce3ee',
          boxShadow: 'none',
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
              ref={(element) => {
                if (element && restoreCaptureFocus.current) {
                  element.focus();
                  restoreCaptureFocus.current = false;
                }
              }}
              type="button"
              className={`${composeStyles.floatingComposeBarInner} w-full`}
              onClick={onOpen}
              aria-label="打开快速记录"
                initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={collapsedTransition}
            >
              <span className={composeStyles.composeEntryIcon}><PencilLine size={20} aria-hidden="true" /></span>
              <motion.span
                className={composeStyles.floatingComposeBarText}
                  initial={{ opacity: 0, y: 1 }}
                animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -1 }}
                transition={collapsedTransition}
              >
                {hasDraft ? '继续编辑草稿…' : '记下一个想法…'}
              </motion.span>
              {!hasDraft && <Plus size={18} className={composeStyles.composeEntryPlus} aria-hidden="true" />}
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
                        opacity: { duration: reduceMotion ? 0 : 0.1, ease: [0.4, 0, 1, 1] as const },
                        y: { duration: reduceMotion ? 0 : 0.1, ease: [0.4, 0, 1, 1] as const },
                      },
                    }}
                  >
                    <NoteTitleField
                      value={title}
                      onChange={(value) => { suggestion.invalidate('title'); onTitleChange(value); }}
                      onKeyDown={handleTitleKeyDown}
                      suggestion={suggestion}
                      hasBodyText={hasTitleSourceText(valueJson, valueText)}
                      saving={loading}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={editorTransition}
                      className={composeStyles.floatingComposeEditor}
                    >
                      <RichTextEditor
                        value={valueJson}
                        onChange={(next) => { suggestion.invalidate('body'); onChange(next); }}
                        placeholder="此刻的想法、待办或总结..."
                        showToolbar
                        autoFocus="end"
                        toolbarVariant="advanced"
                          {...flomoEditorChromeProps}
                        onModEnter={() => {
                          submitAndClose();
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
                      {status && <p className={composeStyles.composeActionStatus} role="status">{status}</p>}
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
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return renderContent();
}

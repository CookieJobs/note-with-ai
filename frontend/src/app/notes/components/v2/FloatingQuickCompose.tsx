'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Maximize2, Send } from 'lucide-react';
import composeStyles from '../../styles/floating-compose.module.scss';
import editorStyles from '../../styles/rich-editor.module.scss';
import { focusProseMirrorWithin } from '../focusProseMirror';

function EditorLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="h-5 w-5 animate-spin rounded-full border-[3px] border-gray-200 border-t-gray-400" />
    </div>
  );
}

const RichTextEditorPromise = import('../RichTextEditor');
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

function FullscreenHeader({ onBack, onSend, canSubmit, loading }: {
  onBack: () => void;
  onSend: () => void;
  canSubmit: boolean;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          title="返回小窗"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>返回</span>
        </button>
        <span className="text-sm font-medium text-gray-500 truncate">编辑</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
          onClick={onSend}
          disabled={!canSubmit}
          title="发送"
        >
          <Send className="h-4 w-4" />
          <span>{loading ? '发送中...' : '发送'}</span>
        </button>
      </div>
    </div>
  );
}

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
  const [hover, setHover] = useState(false);
  const [sharedLayoutEnabled, setSharedLayoutEnabled] = useState(true);
  const expandedRef = useRef<HTMLDivElement | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFullscreen = searchParams?.get('mode') === 'fullscreen';

  const enterFullscreen = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams?.toString() || '');
    nextParams.set('mode', 'fullscreen');
    router.replace(`${pathname}?${nextParams.toString()}`);
  }, [searchParams, router, pathname]);

  const exitFullscreen = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams?.toString() || '');
    nextParams.delete('mode');
    router.replace(`${pathname}?${nextParams.toString()}`);
  }, [searchParams, router, pathname]);

  const exitFullscreenWithoutSharedLayout = useCallback((nextOpen: boolean) => {
    setSharedLayoutEnabled(false);
    setOpen(nextOpen);
    exitFullscreen();
  }, [exitFullscreen]);

  const exitToSmallWindow = useCallback(() => {
    exitFullscreenWithoutSharedLayout(true);
  }, [exitFullscreenWithoutSharedLayout]);

  useEffect(() => {
    if (!isFullscreen) return;
    setOpen(true);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      exitToSmallWindow();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isFullscreen, exitToSmallWindow]);

  // 点击外部：收起（不丢草稿），但在全屏模式下不收起
  useEffect(() => {
    if (!open || isFullscreen) return;
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
  }, [open, isFullscreen]);

  useEffect(() => {
    if (!open && !isFullscreen) return;
    return focusProseMirrorWithin(expandedRef.current);
  }, [open, isFullscreen]);

  useEffect(() => {
    if (isFullscreen || sharedLayoutEnabled) return;
    const raf = requestAnimationFrame(() => {
      setSharedLayoutEnabled(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [isFullscreen, sharedLayoutEnabled]);

  useLayoutEffect(() => {
    if (!open || isFullscreen) return;
    const expanded = expandedRef.current;
    if (!expanded) return;

    const compute = () => {
      const scroller = expanded.querySelector(`.${editorStyles.richEditorScroller}`) as HTMLElement | null;
      if (!scroller) return;
      const rect = expanded.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const bottomSpace = Math.max(0, window.innerHeight - rect.bottom);
      const topSafe = 98; // 顶部标题栏 + 安全边距
      const maxExpanded = Math.max(0, window.innerHeight - topSafe - bottomSpace);
      const fixedH = Math.max(0, rect.height - scrollerRect.height);
      const maxScroller = Math.max(120, maxExpanded - fixedH);
      expanded.style.setProperty('--floating-expanded-max', `${maxExpanded}px`);
      expanded.style.setProperty('--floating-editor-max', `${maxScroller}px`);
    };

    const raf = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', compute);
    };
  }, [open, isFullscreen]);

  const disabled = loading;
  const canSubmit = !disabled && (valueText || '').trim().length > 0;
  const hasDraft = (valueText || '').trim().length > 0;
  const sharedLayoutId = sharedLayoutEnabled ? 'quick-compose-container' : undefined;

  const shellTransition = {
    type: 'spring',
    stiffness: 290,
    damping: 28,
    mass: 0.9,
  } as const;

  const surfaceTransition = {
    duration: 0.24,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  const contentEnterTransition = {
    duration: 0.18,
    delay: 0.045,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  const actionsEnterTransition = {
    duration: 0.18,
    delay: 0.075,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  const submitAndClose = () => {
    if (!canSubmit) return;
    if (isFullscreen) {
      setSharedLayoutEnabled(false);
      exitFullscreen();
    }
    setOpen(false);
    onSubmit();
  };

  const handleCancel = () => {
    if (isFullscreen) {
      setSharedLayoutEnabled(false);
      exitFullscreen();
    }
    onCancel();
    setOpen(false);
  };

  // 渲染悬浮状态或全屏状态
  const renderContent = () => {
    if (isFullscreen) {
      return (
        <motion.div
          key="fullscreen"
          layoutId={sharedLayoutId}
          className="fixed inset-0 z-[1000] bg-white flex flex-col"
          initial={{ opacity: 0, y: 12, scale: 0.992 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.995 }}
          transition={shellTransition}
        >
          <FullscreenHeader
            onBack={exitToSmallWindow}
            onSend={submitAndClose}
            canSubmit={canSubmit}
            loading={loading}
          />
          <div className="flex-1 overflow-y-auto bg-white" ref={expandedRef}>
            <div className="max-w-4xl mx-auto w-full h-full p-4 text-gray-900">
              <RichTextEditor
                value={valueJson}
                onChange={onChange}
                placeholder="此刻的想法、待办或总结..."
                showToolbar
                autoFocus="end"
                toolbarVariant="advanced"
                onModEnter={submitAndClose}
                className="text-gray-900"
              />
            </div>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        key="inline"
        ref={rootRef}
        className={`${composeStyles.inlineCompose} ${open ? composeStyles.floatingComposeOpen : ''} ${hover ? composeStyles.floatingComposeHover : ''}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <motion.div
          layout
          layoutId={sharedLayoutId}
          className={composeStyles.floatingComposeShell}
          transition={shellTransition}
        >
          <AnimatePresence initial={false} mode="wait">
            {!open ? (
              <motion.button
                key="collapsed"
                layout
                type="button"
                className={`${composeStyles.floatingComposeBar}`}
                onClick={() => setOpen(true)}
                aria-label="打开快速记录"
                initial={{ opacity: 0, y: 8, scale: 0.988 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 5, scale: 0.992 }}
                transition={surfaceTransition}
                style={{ transformOrigin: 'center bottom' }}
              >
                <motion.span
                  className={`${composeStyles.floatingComposeBarInner} w-full flex items-center justify-center`}
                  initial={{ opacity: 0.86, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0.82, y: 1 }}
                  transition={contentEnterTransition}
                >
                  <motion.span
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={contentEnterTransition}
                    className={`${composeStyles.floatingComposeBarText}`}
                  >
                    {hasDraft ? '继续编辑草稿…' : '发送消息...'}
                  </motion.span>
                  {hasDraft && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.88, y: 2 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9, y: -1 }}
                      transition={contentEnterTransition}
                      className={`${composeStyles.floatingComposeDraftDot} absolute right-4`}
                      aria-label="有草稿"
                      title="有草稿"
                    />
                  )}
                </motion.span>
              </motion.button>
            ) : (
              <motion.div
                key="expanded"
                layout
                className={`${composeStyles.floatingComposeExpanded} ${composeStyles.floatingComposeExpandedNoSuggest}`}
                ref={expandedRef}
                initial={{ opacity: 0, y: 10, scale: 0.988 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.992 }}
                transition={surfaceTransition}
                style={{ transformOrigin: 'center bottom' }}
              >
                {/* Fullscreen pill — top right */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                  <button
                    type="button"
                    className={composeStyles.fullscreenPill}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={enterFullscreen}
                    aria-label="全屏编辑"
                    title="全屏编辑"
                  >
                    <Maximize2 size={14} />
                    <span>全屏</span>
                  </button>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 7, scale: 0.994 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -2, scale: 0.998 }}
                  transition={contentEnterTransition}
                  className={`${composeStyles.floatingComposeEditor}`}
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
                  initial={{ opacity: 0, y: 8, scale: 0.996 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.998 }}
                  transition={actionsEnterTransition}
                  className={`${composeStyles.floatingComposeActions}`}
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
      </motion.div>
    );
  };

  return renderContent();
}

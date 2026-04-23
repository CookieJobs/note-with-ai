'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Maximize2, Send } from 'lucide-react';
import styles from '../../notes-v2.module.scss';
import RichTextEditor from '../RichTextEditor';
import { focusProseMirrorWithin } from '../focusProseMirror';

type Props = {
  valueJson: any | null;
  valueText: string;
  onChange: (next: { json: any; text: string }) => void;
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
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const bounceTimerRef = useRef<number | null>(null);
  const [bouncing, setBouncing] = useState(false);
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

  const exitToSmallWindow = useCallback(() => {
    setOpen(true);
    exitFullscreen();
  }, [exitFullscreen]);

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
    return () => {
      if (bounceTimerRef.current) window.clearTimeout(bounceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open && !isFullscreen) return;
    return focusProseMirrorWithin(expandedRef.current);
  }, [open, isFullscreen]);

  useLayoutEffect(() => {
    if (!open || isFullscreen) return;
    const expanded = expandedRef.current;
    if (!expanded) return;

    const compute = () => {
      const scroller = expanded.querySelector(`.${styles.richEditorScroller}`) as HTMLElement | null;
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

  const submitAndClose = () => {
    if (!canSubmit) return;
    if (isFullscreen) {
      exitFullscreen();
    }
    setOpen(false);
    onSubmit();
  };

  const handleCancel = () => {
    if (isFullscreen) {
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
          layoutId="quick-compose-container"
          className="fixed inset-0 z-[1000] bg-white flex flex-col"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
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
      <div
        ref={rootRef}
        className={`${styles.inlineCompose} ${open ? styles.floatingComposeOpen : ''} ${hover ? styles.floatingComposeHover : ''}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <motion.div
          layout
          layoutId="quick-compose-container"
          className={`${styles.floatingComposeShell} ${bouncing ? styles.floatingComposeBounce : ''}`}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        >
          <AnimatePresence mode="popLayout">
            {!open ? (
              <motion.button
                key="collapsed"
                layout
                type="button"
                className={`${styles.floatingComposeBar} !bg-white !rounded-2xl !border !border-gray-200/50 !shadow-sm !shadow-gray-200 !px-6 !py-4 !h-auto flex items-center justify-center`}
                onClick={() => {
                  setOpen(true);
                  setBouncing(true);
                  if (bounceTimerRef.current) window.clearTimeout(bounceTimerRef.current);
                  bounceTimerRef.current = window.setTimeout(() => setBouncing(false), 520);
                }}
                aria-label="打开快速记录"
              >
              <span className={`${styles.floatingComposeBarInner} w-full flex items-center justify-center`}>
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ delay: 0.15, duration: 0.2 }}
                  className={`${styles.floatingComposeBarText} !text-gray-500 !font-normal text-center`}
                >
                  {valueText && valueText.trim().length > 0 ? '继续编辑草稿…' : '发送消息...'}
                </motion.span>
                {valueText && valueText.trim().length > 0 && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ delay: 0.15, duration: 0.2 }}
                    className={`${styles.floatingComposeDraftDot} absolute right-4`}
                    aria-label="有草稿"
                    title="有草稿"
                  />
                )}
              </span>
            </motion.button>
            ) : (
              <motion.div
                key="expanded"
                layout
                className={`${styles.floatingComposeExpanded} ${styles.floatingComposeExpandedNoSuggest} !bg-white !rounded-2xl !border !border-gray-200/50 !shadow-sm !shadow-gray-200 !p-4`}
                ref={expandedRef}
              >
              <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ delay: 0.1, duration: 0.2 }}
                  className={`${styles.floatingComposeEditor} !bg-transparent !border-none !shadow-none !text-gray-900 !p-0`}
                >
                <RichTextEditor
                  value={valueJson}
                  onChange={onChange}
                  placeholder="此刻的想法、待办或总结..."
                  showToolbar
                  autoFocus="end"
                  toolbarVariant="advanced"
                  toolbarRight={
                    <>
                      <button
                        type="button"
                        className={styles.floatingComposeMaxBtn}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={enterFullscreen}
                        aria-label="全屏编辑"
                        title="全屏编辑"
                      >
                        <Maximize2 size={16} />
                      </button>
                    </>
                  }
                  onModEnter={() => {
                    submitAndClose();
                  }}
                  className="text-gray-900 !mx-auto"
                />
              </motion.div>

              <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ delay: 0.1, duration: 0.2 }}
                  className={`${styles.floatingComposeActions} !border-t !border-gray-100 !pt-3 !mt-3`}
                >
                <div className={`${styles.floatingComposeHint} !text-gray-400`}>Cmd/Ctrl + Enter 保存</div>
                <button
                  type="button"
                  className={`${styles.noteEditCancel} !bg-white hover:!bg-gray-50 !text-gray-600 !border !border-gray-200 !rounded-lg !px-4 !py-1.5`}
                  onClick={() => {
                    onCancel();
                    setOpen(false);
                  }}
                  disabled={disabled}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={`${styles.noteEditSave} !bg-blue-600 hover:!bg-blue-700 !text-white !rounded-lg !px-4 !py-1.5 !border-none`}
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
      </div>
    );
  };

  return <AnimatePresence mode="popLayout">{renderContent()}</AnimatePresence>;
}

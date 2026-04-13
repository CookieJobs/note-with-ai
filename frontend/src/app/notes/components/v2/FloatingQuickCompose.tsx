'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from '../../notes-v2.module.scss';
import RichTextEditor from '../RichTextEditor';
import { focusProseMirrorWithin } from '../focusProseMirror';
import { Maximize2, Minimize2 } from 'lucide-react';

type Props = {
  valueJson: any | null;
  valueText: string;
  onChange: (next: { json: any; text: string }) => void;
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
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [toolbarVariant, setToolbarVariant] = useState<'simple' | 'advanced'>('simple');
  const bounceTimerRef = useRef<number | null>(null);
  const [bouncing, setBouncing] = useState(false);
  const expandedRef = useRef<HTMLDivElement | null>(null);

  // 点击外部：收起（不丢草稿）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const t = e.target as Node | null;
      if (!t) return;
      if (root.contains(t)) return;
      setOpen(false);
      setMaximized(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    return () => {
      if (bounceTimerRef.current) window.clearTimeout(bounceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    return focusProseMirrorWithin(expandedRef.current);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
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
  }, [open, maximized]);

  const disabled = loading;
  const canSubmit = !disabled && (valueText || '').trim().length > 0;

  const submitAndClose = () => {
    if (!canSubmit) return;
    // 需求：点击保存后立刻折叠（不等待异步请求/重排/动画）
    setOpen(false);
    setMaximized(false);
    onSubmit();
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.inlineCompose} ${open ? styles.floatingComposeOpen : ''} ${hover ? styles.floatingComposeHover : ''} ${maximized ? styles.floatingComposeMaximized : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 同一个壳：折叠态是 bar，展开态变成编辑器（向上长高） */}
      <div className={`${styles.floatingComposeShell} ${bouncing ? styles.floatingComposeBounce : ''}`}>
        {!open ? (
          <button
            type="button"
            className={`${styles.floatingComposeBar} !bg-white !rounded-2xl !border !border-gray-200/50 !shadow-sm !shadow-gray-200 !px-6 !py-4 !h-auto`}
            onClick={() => {
              setOpen(true);
              setBouncing(true);
              if (bounceTimerRef.current) window.clearTimeout(bounceTimerRef.current);
              bounceTimerRef.current = window.setTimeout(() => setBouncing(false), 520);
            }}
            aria-label="打开快速记录"
          >
            <span className={styles.floatingComposeBarInner}>
              <span className={`${styles.floatingComposeBarText} !text-gray-500 !font-normal`}>
                {valueText && valueText.trim().length > 0 ? '继续编辑草稿…' : '发送消息...'}
              </span>
              {valueText && valueText.trim().length > 0 && (
                <span className={styles.floatingComposeDraftDot} aria-label="有草稿" title="有草稿" />
              )}
            </span>
          </button>
        ) : (
          <div
            className={`${styles.floatingComposeExpanded} ${styles.floatingComposeExpandedNoSuggest} !bg-white !rounded-2xl !border !border-gray-200/50 !shadow-sm !shadow-gray-200 !p-4`}
            ref={expandedRef}
          >
            <div className={`${styles.floatingComposeEditor} !bg-transparent !border-none !shadow-none !text-gray-900 !p-0`}>
              <RichTextEditor
                value={valueJson}
                onChange={onChange}
                placeholder="此刻的想法、待办或总结..."
                showToolbar
                autoFocus="end"
                toolbarVariant={toolbarVariant}
                toolbarRight={
                  <>
                    <button
                      type="button"
                      className="!text-xs !px-2 !py-1 !rounded-md hover:!bg-gray-100 !text-gray-500 !bg-transparent !border-none !cursor-pointer !whitespace-nowrap !flex !items-center !justify-center !h-8 !transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setToolbarVariant((v) => (v === 'simple' ? 'advanced' : 'simple'))}
                      aria-label={toolbarVariant === 'simple' ? '切换到复杂模式' : '切换到简单模式'}
                      title={toolbarVariant === 'simple' ? '切换到复杂模式' : '切换到简单模式'}
                    >
                      {toolbarVariant === 'simple' ? '复杂模式' : '简单模式'}
                    </button>
                    <button
                      type="button"
                      className={styles.floatingComposeMaxBtn}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setMaximized((v) => !v)}
                      aria-label={maximized ? '还原' : '最大化'}
                      title={maximized ? '还原' : '最大化'}
                    >
                      {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </>
                }
                onModEnter={() => {
                  submitAndClose();
                }}
              />
            </div>

            <div className={`${styles.floatingComposeActions} !border-t !border-gray-100 !pt-3 !mt-3`}>
              <div className={`${styles.floatingComposeHint} !text-gray-400`}>Cmd/Ctrl + Enter 保存</div>
              <button
                type="button"
                className={`${styles.noteEditCancel} !bg-white hover:!bg-gray-50 !text-gray-600 !border !border-gray-200 !rounded-lg !px-4 !py-1.5`}
                onClick={() => {
                  onCancel();
                  setOpen(false);
                  setMaximized(false);
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../notes.module.scss';
import RichTextEditor from './RichTextEditor';
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
  const bounceTimerRef = useRef<number | null>(null);
  const [bouncing, setBouncing] = useState(false);

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

  const disabled = loading;
  const canSubmit = !disabled && (valueText || '').trim().length > 0;

  return (
    <div
      ref={rootRef}
      className={`${styles.floatingCompose} ${open ? styles.floatingComposeOpen : ''} ${hover ? styles.floatingComposeHover : ''} ${maximized ? styles.floatingComposeMaximized : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 同一个壳：折叠态是 bar，展开态变成编辑器（向上长高） */}
      <div className={`${styles.floatingComposeShell} ${bouncing ? styles.floatingComposeBounce : ''}`}>
        {!open ? (
          <button
            type="button"
            className={styles.floatingComposeBar}
            onClick={() => {
              setOpen(true);
              setBouncing(true);
              if (bounceTimerRef.current) window.clearTimeout(bounceTimerRef.current);
              bounceTimerRef.current = window.setTimeout(() => setBouncing(false), 520);
            }}
            aria-label="打开快速记录"
          >
            <span className={styles.floatingComposeBarInner}>
              <span className={styles.floatingComposeBarText}>
                {valueText && valueText.trim().length > 0 ? '继续编辑草稿…' : '快速记录…'}
              </span>
              {valueText && valueText.trim().length > 0 && (
                <span className={styles.floatingComposeDraftDot} aria-label="有草稿" title="有草稿" />
              )}
            </span>
          </button>
        ) : (
          <div className={styles.floatingComposeExpanded}>
            <div className={styles.floatingComposeHeader}>
              <div className={styles.floatingComposeTitle}>快速记录</div>
              <div className={styles.floatingComposeHeaderRight}>
                <div className={styles.floatingComposeHint}>Cmd/Ctrl + Enter 保存</div>
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
              </div>
            </div>

            <div className={styles.floatingComposeEditor}>
              <RichTextEditor
                value={valueJson}
                onChange={onChange}
                placeholder="此刻的想法、待办或总结..."
                showToolbar
                onModEnter={() => {
                  if (canSubmit) onSubmit();
                }}
                onBlur={() => {
                  // 交给“点击外部”统一处理，避免内部交互导致误收起
                }}
              />
            </div>

            <div className={styles.floatingComposeActions}>
              <button
                type="button"
                className={styles.floatingComposeCancel}
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
                className={styles.floatingComposeSubmit}
                onClick={onSubmit}
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



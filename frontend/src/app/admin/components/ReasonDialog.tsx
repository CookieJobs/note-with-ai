'use client';

import { useEffect, useRef, useState } from 'react';

import styles from '../admin.module.scss';

type ReasonDialogProps = {
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
  title?: string;
};

const focusableSelector = 'textarea, button:not([disabled])';

export default function ReasonDialog({
  onSubmit,
  onClose,
  title = '填写操作原因',
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const trimmedReason = reason.trim();
  const valid = trimmedReason.length >= 5 && trimmedReason.length <= 200;

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!pendingRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  async function submit() {
    if (!valid || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      await onSubmit(trimmedReason);
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '提交失败');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className={styles.dialogBackdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-dialog-title"
      >
        <h3 id="reason-dialog-title">{title}</h3>
        <label>
          原因
          <textarea
            value={reason}
            maxLength={200}
            onChange={(event) => {
              setReason(event.target.value);
              setError('');
            }}
          />
        </label>
        <p className={styles.muted}>请输入 5–200 个字符。</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.toolbar}>
          <button type="button" disabled={!valid || pending} onClick={() => void submit()}>
            {pending ? '提交中…' : '确认'}
          </button>
          <button type="button" disabled={pending} onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

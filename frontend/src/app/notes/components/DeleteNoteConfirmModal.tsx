'use client';

import type { RefObject } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';

type DeleteNoteConfirmModalProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  openerRef?: RefObject<HTMLElement | null>;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
};

export default function DeleteNoteConfirmModal({
  open,
  onCancel,
  onConfirm,
  openerRef,
  title = '删除笔记',
  message = '确定要删除这条笔记吗？此操作无法撤销。',
  confirmText = '删除',
  cancelText = '取消',
}: DeleteNoteConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent
        aria-modal="true"
        className="max-w-sm text-center"
        onCloseAutoFocus={(event) => {
          if (!openerRef?.current?.isConnected) return;
          event.preventDefault();
          openerRef.current.focus();
        }}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full [background:var(--color-status-error-surface)]">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="var(--color-action-danger)" strokeWidth="2" />
            <path d="M15 9l-6 6M9 9l6 6" stroke="var(--color-action-danger)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{message}</DialogDescription>
        <div className="flex justify-center gap-3">
          <Button type="button" variant="outline" size="lg" onClick={onCancel}>{cancelText}</Button>
          <Button type="button" variant="destructive" size="lg" onClick={() => { void onConfirm(); }}>{confirmText}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

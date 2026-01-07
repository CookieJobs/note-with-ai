'use client';

import styles from '../notes.module.scss';

type DeleteNoteConfirmModalProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
};

export default function DeleteNoteConfirmModal({
  open,
  onCancel,
  onConfirm,
  title = '删除笔记',
  message = '确定要删除这条笔记吗？此操作无法撤销。',
  confirmText = '删除',
  cancelText = '取消',
}: DeleteNoteConfirmModalProps) {
  if (!open) return null;

  return (
    <div className={styles.confirmDialog} onClick={onCancel}>
      <div className={styles.confirmDialogContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.confirmIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2" />
            <path d="M15 9l-6 6M9 9l6 6" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h3 className={styles.confirmTitle}>{title}</h3>
        <p className={styles.confirmMessage}>{message}</p>
        <div className={styles.confirmActions}>
          <button className={styles.cancelButton} onClick={onCancel}>
            {cancelText}
          </button>
          <button className={styles.confirmButton} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}



'use client';

import styles from '../styles/modals.module.scss';

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
    <div className={`${styles.confirmDialog} !bg-black/20 !backdrop-blur-sm`} onClick={onCancel}>
      <div className={`${styles.confirmDialogContent} !bg-white !shadow-xl !rounded-2xl !border !border-gray-100 !p-6`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.confirmIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2" />
            <path d="M15 9l-6 6M9 9l6 6" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h3 className={`${styles.confirmTitle} !text-gray-900 !font-semibold !text-lg`}>{title}</h3>
        <p className={`${styles.confirmMessage} !text-gray-500 !text-sm !mt-2 !mb-6`}>{message}</p>
        <div className={`${styles.confirmActions} !gap-3`}>
          <button className={`${styles.cancelButton} !bg-white !text-gray-700 !border !border-gray-300 hover:!bg-gray-50 !rounded-lg !px-4 !py-2 !font-medium`} onClick={onCancel}>
            {cancelText}
          </button>
          <button className={`${styles.confirmButton} !bg-red-500 hover:!bg-red-600 !text-white !border-none !rounded-lg !px-4 !py-2 !font-medium`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}


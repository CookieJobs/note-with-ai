'use client';

import React from 'react';
import styles from '../app/chat/chat.module.scss';

interface DeleteConfirmModalProps {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  show,
  onConfirm,
  onCancel,
}) => {
  if (!show) return null;

  return (
    <div className={styles.confirmModal}>
      <div className={styles.confirmDialog}>
        <h3>确认删除会话</h3>
        <p>您确定要删除此会话吗？此操作不可撤销。</p>
        <div className={styles.confirmButtons}>
          <button onClick={onCancel}>取消</button>
          <button onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;
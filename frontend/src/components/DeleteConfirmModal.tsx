/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
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
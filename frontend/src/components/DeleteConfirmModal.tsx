/*
Input: 异步删除操作与取消回调
Output: 等待确认、禁重入及失败重试的删除弹窗
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import React, { useRef, useState } from 'react';
import styles from '../app/chat/chat.module.scss';
import { usePanelDismiss } from '../hooks/usePanelDismiss';

interface DeleteConfirmModalProps {
  show: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  show,
  onConfirm,
  onCancel,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const cancel = () => { if (!busyRef.current) { setError(''); onCancel(); } };
  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await onConfirm(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : '删除失败，请稍后重试');
    } finally { busyRef.current = false; setBusy(false); }
  };
  const { panelRef } = usePanelDismiss<HTMLDivElement>(
    show,
    cancel,
    Infinity,
  );
  if (!show) return null;

  return (
    <div className={styles.confirmModal}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-chat-title"
        className={styles.confirmDialog}
      >
        <h3 id="delete-chat-title">确认删除会话</h3>
        <p>您确定要删除此会话吗？此操作不可撤销。</p>
        {error && <p role="alert">{error}</p>}
        <div className={styles.confirmButtons}>
          <button className={styles.confirmCancel} disabled={busy} onClick={cancel}>取消</button>
          <button className={styles.confirmDelete} disabled={busy} onClick={confirm}>{busy ? '删除中…' : '确认删除'}</button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;

import { useEffect, useState } from 'react';

import styles from '../../admin.module.scss';
import NoteDiscoveryEnvironmentStatus from '../../components/NoteDiscoveryEnvironmentStatus';
import ReasonDialog from '../../components/ReasonDialog';
import { adminFetch, adminPost } from '../../lib/adminApi';
import type { NoteDiscoveryAccess } from '../../lib/contracts';

export default function NoteDiscoveryAccessPanel({ userId, canWrite, isActive }: {
  userId: string;
  canWrite: boolean;
  isActive: boolean;
}) {
  const endpoint = `/api/admin/users/${encodeURIComponent(userId)}/note-discovery-access`;
  const [access, setAccess] = useState<NoteDiscoveryAccess | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [nextGrant, setNextGrant] = useState<boolean | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void adminFetch<NoteDiscoveryAccess>(endpoint, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setAccess(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : '读取试用权限失败');
        }
      });
    return () => controller.abort();
  }, [endpoint, retry]);

  async function saveAccess(reason: string) {
    if (nextGrant === null) return;
    const result = await adminPost<NoteDiscoveryAccess>(endpoint, { granted: nextGrant, reason });
    setAccess(result);
    setNextGrant(null);
    setNotice('试用权限已更新');
  }

  return (
    <section className={styles.panel} aria-labelledby="note-discovery-access-title">
      <div className={styles.panelHeader}>
        <div>
          <h3 className={styles.panelTitle} id="note-discovery-access-title">笔记发现 Agent</h3>
          <p className={styles.panelDescription}>开放后，用户可在笔记页手动检查，也可以自行开启自动发现。</p>
        </div>
        {access && <span className={`${styles.statusBadge} ${access.granted ? styles.statusGood : styles.statusNeutral}`}>
          {access.granted ? '已开放' : '未开放'}
        </span>}
      </div>
      {!access && !error && <p>正在读取试用权限…</p>}
      {error && (
        <div>
          <p role="alert" aria-label="笔记发现试用权限错误" className={styles.error}>{error}</p>
          <button type="button" className={styles.secondaryButton} onClick={() => {
            setError('');
            setRetry((current) => current + 1);
          }}>重新读取试用权限</button>
        </div>
      )}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {access && (
        <>
          <div className={styles.toolbar}>
            <NoteDiscoveryEnvironmentStatus environment={access.environment} />
            {canWrite && <button
              type="button"
              className={access.granted ? styles.secondaryButton : styles.primaryButton}
              disabled={!access.granted && !isActive}
              onClick={() => { setNotice(''); setNextGrant(!access.granted); }}
            >
              {access.granted ? '撤销试用' : '开放试用'}
            </button>}
          </div>
          {!isActive && <p className={styles.panelDescription}>账户已禁用，恢复账户后才能使用。</p>}
          {isActive && !access.environment.runnable && (
            <p className={styles.panelDescription}>试用权限可先保存，用户入口在环境配置就绪后可见。</p>
          )}
        </>
      )}
      {nextGrant !== null && (
        <ReasonDialog
          title={nextGrant ? '开放笔记发现试用' : '撤销笔记发现试用'}
          onClose={() => setNextGrant(null)}
          onSubmit={saveAccess}
        />
      )}
    </section>
  );
}

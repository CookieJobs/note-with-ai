import { useEffect, useState } from 'react';

import styles from '../admin.module.scss';
import NoteDiscoveryEnvironmentStatus from '../components/NoteDiscoveryEnvironmentStatus';
import { adminFetch } from '../lib/adminApi';
import type { NoteDiscoveryEnvironment } from '../lib/contracts';

export default function NoteDiscoveryEnvironmentPanel() {
  const [environment, setEnvironment] = useState<NoteDiscoveryEnvironment | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void adminFetch<NoteDiscoveryEnvironment>('/api/admin/ai/note-discovery-status', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setEnvironment(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : '读取环境配置失败');
        }
      });
    return () => controller.abort();
  }, [retry]);

  return (
    <section className={styles.panel} aria-labelledby="note-discovery-environment-title">
      <div className={styles.panelHeader}>
        <div>
          <h3 className={styles.panelTitle} id="note-discovery-environment-title">笔记发现 Agent</h3>
          <p className={styles.panelDescription}>环境总开关、计费与预算由部署配置管理。试用权限在用户详情中设置。</p>
        </div>
        {environment && <NoteDiscoveryEnvironmentStatus environment={environment} />}
      </div>
      {!environment && !error && <p>正在读取 Agent 环境配置…</p>}
      {error && (
        <div>
          <p role="alert" aria-label="笔记发现环境配置错误" className={styles.error}>{error}</p>
          <button type="button" className={styles.secondaryButton} onClick={() => {
            setError('');
            setRetry((current) => current + 1);
          }}>重新读取环境配置</button>
        </div>
      )}
      {environment?.runnable && <p className={styles.panelDescription}>发现任务还需要后台 Worker 运行。</p>}
    </section>
  );
}

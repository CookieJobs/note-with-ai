import { useEffect, useState } from 'react';

import styles from '../admin.module.scss';
import NoteDiscoveryBillingForm from './NoteDiscoveryBillingForm';
import ReasonDialog from '../components/ReasonDialog';
import NoteDiscoveryEnvironmentStatus from '../components/NoteDiscoveryEnvironmentStatus';
import { adminFetch } from '../lib/adminApi';
import type { NoteDiscoveryEnvironment } from '../lib/contracts';

const endpoint = '/api/admin/ai/note-discovery-status';

export default function NoteDiscoveryEnvironmentPanel({ canManage }: { canManage: boolean }) {
  const [environment, setEnvironment] = useState<NoteDiscoveryEnvironment | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState<boolean | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const configurationIssues = environment?.configurationIssues ?? [];

  useEffect(() => {
    const controller = new AbortController();
    void adminFetch<NoteDiscoveryEnvironment>(endpoint, { signal: controller.signal })
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
          <p className={styles.panelDescription}>总开关适用于已获试用权限的用户。试用权限在用户详情中设置。</p>
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
      {environment && !environment.configured && (
        <div>
          <p className={styles.panelDescription}>开启前，请由所有者填写模型计费与预算。</p>
          {configurationIssues.length > 0 && (
            <details>
              <summary>查看配置缺项（{configurationIssues.length} 项）</summary>
              <ul>
                {configurationIssues.map(({ key, reason }) => (
                  <li key={key}><code>{key === 'billingModels' ? '已保存的模型计费' : key}</code> · <span>{reason === 'missing' ? '未填写' : '与当前模型配置不匹配'}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {environment && canManage && (
        <div className={styles.toolbar}>
          <button type="button" className={styles.secondaryButton} aria-expanded={billingOpen} onClick={() => {
            setSaved(false);
            setBillingOpen(!billingOpen);
          }}>{billingOpen ? '收起计费与预算' : '配置计费与预算'}</button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={billingOpen || (!environment.enabled && !environment.configured)}
            onClick={() => setTarget(!environment.enabled)}
          >{environment.enabled ? '关闭环境总开关' : '开启环境总开关'}</button>
        </div>
      )}
      {billingOpen && canManage && <NoteDiscoveryBillingForm onSaved={(updated) => {
        setEnvironment(updated);
        setBillingOpen(false);
        setSaved(true);
      }} />}
      {saved && <p role="status">计费与预算已保存。</p>}
      {target !== null && (
        <ReasonDialog
          title={target ? '开启笔记发现 Agent' : '关闭笔记发现 Agent'}
          onClose={() => setTarget(null)}
          onSubmit={async (reason) => {
            const updated = await adminFetch<NoteDiscoveryEnvironment>(endpoint, {
              method: 'POST',
              body: JSON.stringify({ enabled: target, reason }),
            });
            setEnvironment(updated);
            setTarget(null);
          }}
        />
      )}
      {environment?.runnable && <p className={styles.panelDescription}>发现任务还需要后台 Worker 运行。</p>}
    </section>
  );
}

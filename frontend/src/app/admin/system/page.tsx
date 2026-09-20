'use client';

import { useCallback, useEffect, useState } from 'react';

import styles from '../admin.module.scss';
import { adminFetch } from '../lib/adminApi';
import type { SystemHealth } from '../lib/contracts';
import { formatUptime } from '../lib/presentation';

const databaseStates: Record<string, string> = {
  connected: '数据库已连接',
  connecting: '数据库连接中',
  disconnected: '数据库未连接',
  disconnecting: '数据库断开中',
  unknown: '数据库状态未知',
};

export default function SystemPage() {
  const [data, setData] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await adminFetch<SystemHealth>('/api/admin/system/health'));
    } catch (loadError: unknown) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const databaseConnected = data?.mongo.readyState === 'connected';
  const aiStatus = data?.aiSuccessRate24h === null
    ? '暂无调用数据'
    : data?.aiSuccessRate24h === 1
      ? '最近 24 小时调用全部成功'
      : '最近 24 小时存在未成功调用';

  return (
    <section>
      <header className={styles.pageHeader}>
        <div>
          <h2>系统健康</h2>
          <p className={styles.pageDescription}>分别查看数据库连接、AI 调用结果和应用运行信息。</p>
        </div>
        {data && <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void load()}>{loading ? '刷新中…' : '刷新状态'}</button>}
      </header>
      {loading && !data && <p role="status">加载系统状态中…</p>}
      {error && (
        <div className={styles.emptyState}>
          <p role="alert" className={styles.error}>{error}</p>
          <button className={styles.secondaryButton} type="button" onClick={() => void load()}>重新加载系统状态</button>
        </div>
      )}
      {data && (
        <>
          <div className={styles.detailGrid}>
            <section className={styles.panel} aria-labelledby="database-health-title">
              <div className={styles.panelHeader}>
                <div>
                  <h3 id="database-health-title" className={styles.panelTitle}>数据库连接</h3>
                  <p className={styles.panelDescription}>MongoDB 当前连接状态。</p>
                </div>
              </div>
              <p role="status" className={`${styles.statusBadge} ${databaseConnected ? styles.statusGood : styles.statusWarning}`}>
                {Object.hasOwn(databaseStates, data.mongo.readyState) ? databaseStates[data.mongo.readyState] : data.mongo.readyState}
              </p>
              <p className={styles.muted}>此状态反映数据库连接情况，AI 处理情况请查看右侧数据。</p>
            </section>
            <section className={styles.panel} aria-labelledby="ai-health-title">
              <div className={styles.panelHeader}>
                <div>
                  <h3 id="ai-health-title" className={styles.panelTitle}>AI 处理</h3>
                  <p className={styles.panelDescription}>调用成功率统计范围为最近 24 小时。</p>
                </div>
                <a className={styles.textLink} href="/admin/ai">查看 AI 使用与异常</a>
              </div>
              <p role="status" className={`${styles.statusBadge} ${data.aiSuccessRate24h === null ? styles.statusNeutral : data.aiSuccessRate24h === 1 ? styles.statusGood : styles.statusWarning}`}>{aiStatus}</p>
              <dl className={styles.definitionList}>
                <div><dt>调用成功率</dt><dd className={styles.numeric}>{data.aiSuccessRate24h === null ? '—' : `${Math.round(data.aiSuccessRate24h * 100)}%`}</dd></div>
                <div><dt>当前处理失败记录</dt><dd className={styles.numeric}>{data.failedArtifacts.toLocaleString()} 条</dd></div>
              </dl>
            </section>
          </div>
          <section className={styles.panel} aria-labelledby="application-health-title">
            <div className={styles.panelHeader}>
              <h3 id="application-health-title" className={styles.panelTitle}>应用运行信息</h3>
            </div>
            <dl className={styles.definitionList}>
              <div><dt>持续运行</dt><dd>{formatUptime(data.uptimeSeconds)}</dd></div>
              <div><dt>应用版本</dt><dd className={styles.mono}>{data.applicationVersion}</dd></div>
            </dl>
          </section>
        </>
      )}
    </section>
  );
}

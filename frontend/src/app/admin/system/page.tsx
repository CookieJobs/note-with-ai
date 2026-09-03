'use client';

import { useCallback, useEffect, useState } from 'react';

import styles from '../admin.module.scss';
import MetricCard from '../components/MetricCard';
import { adminFetch } from '../lib/adminApi';
import type { SystemHealth } from '../lib/contracts';

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

  if (loading && !data) return <p role="status">加载系统状态中…</p>;
  if (error && !data) {
    return (
      <section>
        <p role="alert" className={styles.error}>{error}</p>
        <button type="button" onClick={() => void load()}>重新加载系统状态</button>
      </section>
    );
  }
  if (!data) return null;

  const healthy = data.mongo.readyState === 'connected';
  return (
    <section>
      <h2>系统健康</h2>
      <p role="status">{healthy ? '健康' : '降级'}</p>
      <div className={styles.grid}>
        <MetricCard label="MongoDB" value={data.mongo.readyState} />
        <MetricCard label="运行 uptime（秒）" value={data.uptimeSeconds} />
        <MetricCard label="应用版本" value={data.applicationVersion} />
        <MetricCard label="失败富化" value={data.failedArtifacts} />
        <MetricCard
          label="AI 成功率（24h）"
          value={data.aiSuccessRate24h === null ? null : `${Math.round(data.aiSuccessRate24h * 100)}%`}
        />
      </div>
    </section>
  );
}

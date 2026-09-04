'use client';

import { useCallback, useEffect, useState } from 'react';

import styles from './admin.module.scss';
import MetricCard from './components/MetricCard';
import TrendChart from './components/TrendChart';
import { adminFetch } from './lib/adminApi';
import type { Overview } from './lib/contracts';

type OverviewRange = '7d' | '30d';

const percent = (value: number | null): string | null => (
  value === null ? null : `${Math.round(value * 100)}%`
);

const cost = (micros: number | null): string | null => (
  micros === null ? null : `¥${(micros / 1_000_000).toFixed(2)}`
);

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [range, setRange] = useState<OverviewRange>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (targetRange: OverviewRange) => {
    setLoading(true);
    setError('');
    try {
      setData(await adminFetch<Overview>(`/api/admin/overview?range=${targetRange}`));
    } catch (loadError: unknown) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [load, range]);

  if (loading && !data) return <p>加载概览中…</p>;
  if (error && !data) {
    return (
      <section>
        <p role="alert" className={styles.error}>{error}</p>
        <button type="button" onClick={() => void load(range)}>重新加载概览</button>
      </section>
    );
  }
  if (!data) return null;

  const { summary, retention, tokenCoverage, costCoverage, timeseries } = data;
  const totalTokens = tokenCoverage.inputTokens + tokenCoverage.outputTokens;
  const isEmpty = Object.values(summary).every((value) => value === 0 || value === null)
    && timeseries.every((point) => point.value === 0);

  return (
    <section>
      <h2>数据概览</h2>
      <div className={styles.toolbar} aria-label="概览时间范围">
        <button type="button" aria-pressed={range === '7d'} onClick={() => setRange('7d')}>7 天</button>
        <button type="button" aria-pressed={range === '30d'} onClick={() => setRange('30d')}>30 天</button>
      </div>
      {loading && <p role="status">正在更新概览…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {isEmpty && <p role="status" aria-label="概览空状态">当前范围暂无运营数据</p>}
      <div className={styles.grid}>
        <MetricCard label="总用户" value={summary.totalUsers} />
        <MetricCard label="今日新增" value={summary.todayNewUsers} />
        <MetricCard label="DAU" value={summary.dau} />
        <MetricCard label="WAU" value={summary.wau} />
        <MetricCard label="MAU" value={summary.mau} />
        <MetricCard label="激活用户" value={summary.activationUsers} />
        <MetricCard label="笔记" value={summary.totalNotes} />
        <MetricCard label="聊天会话" value={summary.totalChats} />
        <MetricCard label="AI 调用" value={summary.totalAiCalls} />
        <MetricCard label="AI 成功率" value={percent(summary.aiSuccessRate)} />
        <MetricCard label="失败富化" value={summary.failedArtifacts} />
        <MetricCard label="Token" value={tokenCoverage.rate === null ? null : totalTokens} />
        <MetricCard label="估算成本" value={cost(costCoverage.estimatedCostMicros)} />
      </div>
      <div className={styles.card}>
        <h3>趋势</h3>
        <TrendChart values={timeseries.map((point) => point.value)} />
        <p>
          Token 覆盖：{percent(tokenCoverage.rate) ?? '数据积累中'}；
          成本覆盖：{percent(costCoverage.rate) ?? '数据积累中'}
        </p>
        <p>
          D1：{percent(retention.d1) ?? '数据积累中'} ·{' '}
          D7：{percent(retention.d7) ?? '数据积累中'} ·{' '}
          D30：{percent(retention.d30) ?? '数据积累中'}
        </p>
      </div>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './admin.module.scss';
import MetricCard from './components/MetricCard';
import TrendChart from './components/TrendChart';
import { adminFetch } from './lib/adminApi';
import type { Overview } from './lib/contracts';

type OverviewRange = '7d' | '30d';
type OverviewSnapshot = { overview: Overview; range: OverviewRange };

const percent = (value: number | null): string | null => (
  value === null ? null : `${Math.round(value * 100)}%`
);
const cost = (micros: number | null): string | null => (
  micros === null ? null : `¥${(micros / 1_000_000).toFixed(2)}`
);
const rangeLabel = (range: OverviewRange): string => range === '7d' ? '近 7 天' : '近 30 天';
const count = (value: number): string => value.toLocaleString('zh-CN');

export default function AdminOverviewPage() {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [range, setRange] = useState<OverviewRange>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async (targetRange: OverviewRange) => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const overview = await adminFetch<Overview>(`/api/admin/overview?range=${targetRange}`);
      if (currentRequest === requestId.current) setSnapshot({ overview, range: targetRange });
    } catch (loadError: unknown) {
      if (currentRequest === requestId.current) {
        setError(loadError instanceof Error ? loadError.message : '加载失败');
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
    return () => { requestId.current += 1; };
  }, [load, range]);

  const data = snapshot?.overview;
  const displayedRange = rangeLabel(snapshot?.range ?? range);
  const summary = data?.summary;
  const hasAiCalls = !!summary && summary.totalAiCalls > 0;
  const needsAttention = !!summary && (summary.failedArtifacts > 0
    || (hasAiCalls && summary.aiSuccessRate !== null && summary.aiSuccessRate < 1));
  const aiState = summary?.failedArtifacts ? '有失败待处理'
    : !hasAiCalls ? '暂无调用'
      : summary?.aiSuccessRate === null ? '等待统计'
        : needsAttention ? '存在未成功调用' : '调用全部成功';
  const isEmpty = data && Object.values(data.summary).every((value) => value === 0 || value === null)
    && data.timeseries.every((point) => point.value === 0);
  const knownTokens = data && data.tokenCoverage.rate !== null && data.tokenCoverage.rate > 0
    ? count(data.tokenCoverage.inputTokens + data.tokenCoverage.outputTokens) : '暂无已知用量';

  return (
    <section>
      <header className={styles.pageHeader}>
        <div>
          <h2>数据概览</h2>
          <p className={styles.pageDescription}>了解用户活跃、内容增长与 AI 使用情况。</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.muted}>趋势与 AI 统计</span>
          <div className={styles.rangeControl} role="group" aria-label="概览时间范围">
            <button type="button" aria-pressed={range === '7d'} onClick={() => setRange('7d')}>7 天</button>
            <button type="button" aria-pressed={range === '30d'} onClick={() => setRange('30d')}>30 天</button>
          </div>
        </div>
      </header>

      {loading && !data && (
        <div role="status" aria-label="加载概览中">
          <p className={styles.muted}>加载概览中…</p>
          <div className={styles.skeletonGrid} aria-hidden="true">
            {[0, 1, 2, 3].map((item) => <div className={styles.skeleton} key={item} />)}
          </div>
        </div>
      )}
      {loading && data && <p role="status" className={styles.muted}>正在更新概览…当前显示{displayedRange}数据。</p>}
      {error && (
        <div className={styles.toolbar}>
          <p role="alert" className={styles.error}>
            {error}{data ? `；当前保留上次加载的${displayedRange}数据。` : ''}
          </p>
          <button type="button" onClick={() => void load(range)}>重新加载概览</button>
        </div>
      )}
      {isEmpty && <p role="status" aria-label="概览空状态" className={styles.emptyState}>当前暂无运营数据。用户开始创建笔记后，这里会展示增长与使用情况。</p>}

      {data && summary && (
        <>
          <div className={styles.summaryGrid}>
            <MetricCard label="总用户" value={summary.totalUsers} hint="累计注册用户" />
            <MetricCard label="笔记总量" value={summary.totalNotes} hint="当前笔记总数" />
            <MetricCard label="今日活跃" value={summary.dau} hint="DAU · 今日去重活跃用户" />
            <MetricCard label="AI 调用" value={summary.totalAiCalls} hint={`${displayedRange} · 含成功与未成功调用`} />
          </div>

          <div className={styles.overviewColumns}>
            <section className={styles.panel} aria-labelledby="note-trend-title">
              <div className={styles.panelHeader}>
                <div>
                  <h3 id="note-trend-title" className={styles.panelTitle}>每日新增笔记</h3>
                  <p className={styles.panelDescription}>{displayedRange} · 按上海时间统计</p>
                </div>
              </div>
              <TrendChart points={data.timeseries} />
            </section>

            <section className={styles.panel} aria-labelledby="ai-status-title">
              <div className={styles.panelHeader}>
                <div>
                  <h3 id="ai-status-title" className={styles.panelTitle}>AI 运行</h3>
                  <p className={styles.panelDescription}>{displayedRange}调用与已知用量</p>
                </div>
                <span className={`${styles.statusBadge} ${needsAttention ? styles.statusWarning : hasAiCalls && summary.aiSuccessRate !== null ? styles.statusGood : styles.statusNeutral}`}>
                  {aiState}
                </span>
              </div>
              <dl className={styles.definitionList}>
                <div className={styles.statRow}><dt>AI 成功率</dt><dd>{hasAiCalls ? percent(summary.aiSuccessRate) ?? '等待统计' : '暂无调用'}</dd></div>
                <div className={styles.statRow}>
                  <dt>已知 Token 用量 <small>输入 + 输出 · 仅已采集的成功调用</small></dt>
                  <dd>{knownTokens}</dd>
                </div>
                <div className={styles.statRow}>
                  <dt>估算成本 <small>仅已知价格的成功调用</small></dt>
                  <dd>{cost(data.costCoverage.estimatedCostMicros) ?? '暂不可估算'}</dd>
                </div>
                <div className={styles.statRow}>
                  <dt>AI 处理失败 <small>当前失败的笔记处理项 · 不随时间范围变化</small></dt>
                  <dd className={summary.failedArtifacts ? styles.error : undefined}>{count(summary.failedArtifacts)}</dd>
                </div>
              </dl>
              <p className={styles.panelDescription}>
                Token 覆盖：{percent(data.tokenCoverage.rate) ?? '待积累'} · 成本覆盖：{percent(data.costCoverage.rate) ?? '待积累'}
              </p>
              <Link className={styles.textLink} href="/admin/ai">查看 AI 用量与失败详情</Link>
            </section>
          </div>

          <div className={styles.detailGrid}>
            <section className={styles.panel} aria-labelledby="user-activity-title">
              <div className={styles.panelHeader}>
                <div>
                  <h3 id="user-activity-title" className={styles.panelTitle}>用户活跃</h3>
                  <p className={styles.panelDescription}>固定统计窗口，不受上方范围切换影响</p>
                </div>
                <Link className={styles.textLink} href="/admin/users">查看用户</Link>
              </div>
              <dl className={styles.definitionList}>
                <div className={styles.statRow}><dt>今日新增用户</dt><dd>{count(summary.todayNewUsers)}</dd></div>
                <div className={styles.statRow}><dt>近 7 天活跃 <small>WAU · 去重用户</small></dt><dd>{count(summary.wau)}</dd></div>
                <div className={styles.statRow}><dt>近 30 天活跃 <small>MAU · 去重用户</small></dt><dd>{count(summary.mau)}</dd></div>
                <div className={styles.statRow}>
                  <dt>累计激活用户 <small>注册 7 天内创建笔记且至少一项 AI 处理完成</small></dt>
                  <dd>{count(summary.activationUsers)}</dd>
                </div>
                <div className={styles.statRow}><dt>累计聊天会话</dt><dd>{count(summary.totalChats)}</dd></div>
              </dl>
            </section>

            <section className={styles.panel} aria-labelledby="retention-title">
              <div className={styles.panelHeader}>
                <div>
                  <h3 id="retention-title" className={styles.panelTitle}>用户留存</h3>
                  <p className={styles.panelDescription}>注册后第 N 天再次活跃的用户占比</p>
                </div>
                <span className={`${styles.statusBadge} ${styles.statusNeutral}`}>采集覆盖待核实</span>
              </div>
              <dl className={styles.definitionList}>
                {([
                  ['d1', '次日留存', 'D1'],
                  ['d7', '7 日留存', 'D7'],
                  ['d30', '30 日留存', 'D30'],
                ] as const).map(([key, label, day]) => (
                  <div className={styles.retentionRow} key={key}>
                    <dt>{label} <small>{day}</small></dt>
                    <dd>{percent(data.retention[key]) ?? '数据积累中'}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.panelDescription}>
                基于近 400 天注册且已完整经过相应观察期的用户，不随上方范围变化。历史活跃事件的采集覆盖尚待核实，当前结果仅供参考。
              </p>
            </section>
          </div>
        </>
      )}
    </section>
  );
}

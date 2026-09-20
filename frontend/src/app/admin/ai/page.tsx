'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import styles from '../admin.module.scss';
import ReasonDialog from '../components/ReasonDialog';
import { adminFetch, adminPost } from '../lib/adminApi';
import { formatDateTime, operationLabel, retryStatusLabels } from '../lib/presentation';
import type {
  AdminIdentity,
  AiUsage,
  FailedArtifact,
  ListResponse,
  Pagination,
  UsageGroup,
} from '../lib/contracts';

type UsageRange = '7d' | '30d';
type RetryResult = { retryStatus: 'saved' | 'failed' | 'stale' };
type UsageSnapshot = { usage: AiUsage; range: UsageRange };

const emptyPagination: Pagination = { page: 1, limit: 20, total: 0, hasNext: false };

const percentage = (numerator: number, denominator: number): string => (
  denominator === 0 ? '数据积累中' : `${Math.round((numerator / denominator) * 100)}%`
);

const groupTokens = (group: UsageGroup): string => {
  if (group.inputTokens === null) return '数据积累中';
  if (group.operation === 'embedding') return String(group.inputTokens);
  if (group.outputTokens === null) return '数据积累中';
  return String(group.inputTokens + group.outputTokens);
};

const groupCost = (group: UsageGroup): string => (
  group.estimatedCostMicros === null
    ? '数据积累中'
    : `¥${(group.estimatedCostMicros / 1_000_000).toFixed(2)}`
);

const rangeLabel = (range: UsageRange): string => range === '7d' ? '近 7 天' : '近 30 天';

export default function AiPage() {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityError, setIdentityError] = useState('');

  const [range, setRange] = useState<UsageRange>('30d');
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState('');
  const usageRequestId = useRef(0);

  const [failurePage, setFailurePage] = useState(1);
  const [failures, setFailures] = useState<ListResponse<FailedArtifact>>({
    items: [],
    pagination: emptyPagination,
  });
  const [failuresLoading, setFailuresLoading] = useState(true);
  const [failuresError, setFailuresError] = useState('');

  const [selected, setSelected] = useState<FailedArtifact | null>(null);
  const [retryResult, setRetryResult] = useState('');

  const loadIdentity = useCallback(async () => {
    setIdentityLoading(true);
    setIdentityError('');
    try {
      const result = await adminFetch<{ admin: AdminIdentity }>('/api/admin/auth/me');
      setAdmin(result.admin);
    } catch (error: unknown) {
      setIdentityError(error instanceof Error ? error.message : '身份加载失败');
    } finally {
      setIdentityLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async (targetRange: UsageRange) => {
    const currentRequest = ++usageRequestId.current;
    setUsageLoading(true);
    setUsageError('');
    try {
      const nextUsage = await adminFetch<AiUsage>(`/api/admin/ai/usage?range=${targetRange}`);
      if (currentRequest === usageRequestId.current) {
        setUsageSnapshot({ usage: nextUsage, range: targetRange });
      }
    } catch (error: unknown) {
      if (currentRequest === usageRequestId.current) {
        setUsageError(error instanceof Error ? error.message : '用量加载失败');
      }
    } finally {
      if (currentRequest === usageRequestId.current) setUsageLoading(false);
    }
  }, []);

  const loadFailures = useCallback(async (page: number) => {
    setFailuresLoading(true);
    setFailuresError('');
    try {
      setFailures(await adminFetch<ListResponse<FailedArtifact>>(
        `/api/admin/ai/failures?page=${page}&limit=20`,
      ));
    } catch (error: unknown) {
      setFailuresError(error instanceof Error ? error.message : '失败任务加载失败');
    } finally {
      setFailuresLoading(false);
    }
  }, []);

  useEffect(() => { void loadIdentity(); }, [loadIdentity]);
  useEffect(() => {
    void loadUsage(range);
    return () => { usageRequestId.current += 1; };
  }, [loadUsage, range]);
  useEffect(() => { void loadFailures(failurePage); }, [failurePage, loadFailures]);

  const canRetry = admin?.role === 'owner' || admin?.role === 'operator';
  const usage = usageSnapshot?.usage ?? null;
  const displayedUsageRange = usageSnapshot?.range ?? range;
  const usageRangeLabel = rangeLabel(displayedUsageRange);

  async function retry(reason: string) {
    if (!selected) return;
    setRetryResult('');
    const result = await adminPost<RetryResult>(
      `/api/admin/ai/failures/${selected.noteId}/retry`,
      {
        artifact: selected.artifact,
        expectedRevision: selected.currentRevision,
        reason,
      },
    );
    await loadFailures(failurePage);
    setSelected(null);
    setRetryResult(`重试结果：${retryStatusLabels[result.retryStatus] ?? result.retryStatus}`);
  }

  return (
    <section>
      <header className={styles.pageHeader}>
        <div>
          <h2>AI 使用与异常</h2>
          <p className={styles.pageDescription}>查看调用用量与数据覆盖情况，跟进笔记 AI 处理失败记录。</p>
        </div>
      </header>

      <section aria-labelledby="ai-identity-title">
        <h3 id="ai-identity-title" className={styles.visuallyHidden}>重试权限</h3>
        {identityLoading && <p>正在确认重试权限…</p>}
        {identityError && (
          <div>
            <p role="alert" aria-label="管理员身份错误" className={styles.error}>{identityError}</p>
            <button type="button" onClick={() => void loadIdentity()}>重新确认重试权限</button>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="ai-usage-title">
        <div className={styles.panelHeader}>
          <div>
            <h3 id="ai-usage-title" className={styles.panelTitle}>AI 用量</h3>
            <p className={styles.panelDescription}>
              {usage ? `当前显示${usageRangeLabel}数据。` : `待加载${rangeLabel(range)}数据。`}
              按服务商与操作汇总；Token 和成本仅包含已采集数据。
            </p>
          </div>
          <div className={styles.headerActions} aria-label="AI 用量时间范围">
            <button className={range === '7d' ? styles.primaryButton : styles.secondaryButton} type="button" aria-pressed={range === '7d'} onClick={() => setRange('7d')}>7 天</button>
            <button className={range === '30d' ? styles.primaryButton : styles.secondaryButton} type="button" aria-pressed={range === '30d'} onClick={() => setRange('30d')}>30 天</button>
          </div>
        </div>
        {usageLoading && <p>{`正在加载${rangeLabel(range)}数据${usage ? `，当前仍显示${usageRangeLabel}数据` : ''}…`}</p>}
        {usageError && (
          <div>
            <p role="alert" aria-label="AI 用量错误" className={styles.error}>
              {usageError}{usage ? ` 当前仍显示${usageRangeLabel}数据。` : ''}
            </p>
            <button type="button" onClick={() => void loadUsage(range)}>重新加载 AI 用量</button>
          </div>
        )}
        {!usageLoading && !usageError && usage?.groups.length === 0 && <div className={styles.emptyState}><h3>暂无 AI 用量</h3><p>当前时间范围尚无调用记录，可切换时间范围查看。</p></div>}
        {usage && usage.groups.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>服务商</th><th>操作</th><th className={styles.numeric}>调用次数</th><th className={styles.numeric}>成功率</th>
                  <th className={styles.numeric}>已知 Token</th><th className={styles.numeric}>Token 覆盖率</th><th className={styles.numeric}>估算成本</th><th className={styles.numeric}>成本覆盖率</th>
                </tr>
              </thead>
              <tbody>
                {usage.groups.map((group) => (
                  <tr key={`${group.provider}-${group.operation}`}>
                    <td>{group.provider}</td>
                    <td>{operationLabel(group.operation)}</td>
                    <td className={styles.numeric}>{group.calls}</td>
                    <td className={styles.numeric}>{percentage(group.succeeded, group.calls)}</td>
                    <td className={styles.numeric}>{groupTokens(group)}</td>
                    <td className={styles.numeric}>{percentage(group.knownTokenCalls, group.succeeded)}</td>
                    <td className={styles.numeric}>{groupCost(group)}</td>
                    <td className={styles.numeric}>{percentage(group.costKnownCalls, group.succeeded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="ai-failures-title">
        <div className={styles.panelHeader}>
          <div>
            <h3 id="ai-failures-title" className={styles.panelTitle}>AI 处理失败</h3>
            <p className={styles.panelDescription}>重试前会校验笔记版本，操作需要填写原因。</p>
          </div>
          <span className={`${styles.statusBadge} ${failures.pagination.total > 0 ? styles.statusWarning : styles.statusNeutral}`}>
            {failures.pagination.total} 条记录
          </span>
        </div>
        {failuresLoading && <p>加载失败任务中…</p>}
        {failuresError && (
          <div>
            <p role="alert" aria-label="失败任务错误" className={styles.error}>{failuresError}</p>
            <button type="button" onClick={() => void loadFailures(failurePage)}>重新加载失败任务</button>
          </div>
        )}
        {retryResult && <p role="status" className={styles.notice}>{retryResult}</p>}
        {!failuresLoading && !failuresError && failures.items.length === 0 && <div className={styles.emptyState}><h3>暂无失败任务</h3><p>当前没有需要跟进的 AI 处理失败记录。</p></div>}
        <ul className={styles.list}>
          {failures.items.map((item) => (
            <li key={`${item.noteId}-${item.artifact}`}>
              <div>
                <div className={styles.toolbar}>
                  <strong>{operationLabel(item.artifact)}</strong>
                  <span className={`${styles.statusBadge} ${styles.statusDanger}`}>处理失败</span>
                </div>
                <p className={styles.metadata}>笔记 <span className={styles.mono}>{item.noteId}</span></p>
                <p className={`${styles.metadata} ${styles.muted}`}>
                  用户 {item.userId} · 当前版本 {item.currentRevision} · 尝试版本 {item.sourceRevision}
                </p>
                <p className={`${styles.metadata} ${styles.muted}`}>最近尝试：{formatDateTime(item.attemptedAt)}</p>
                <p className={`${styles.metadata} ${styles.mono}`}>{item.errorCode ?? '未知错误'}</p>
              </div>
              {canRetry && (
                <button className={styles.secondaryButton} type="button" onClick={() => setSelected(item)}>安全重试</button>
              )}
            </li>
          ))}
        </ul>
        <div className={styles.pagination} aria-label="失败任务分页">
          <span>第 {failures.pagination.page} 页</span>
          <button
            className={styles.secondaryButton}
            type="button"
            aria-label="上一页失败任务"
            disabled={failures.pagination.page <= 1 || failuresLoading}
            onClick={() => setFailurePage(failures.pagination.page - 1)}
          >上一页</button>
          <button
            className={styles.secondaryButton}
            type="button"
            aria-label="下一页失败任务"
            disabled={!failures.pagination.hasNext || failuresLoading}
            onClick={() => setFailurePage(failures.pagination.page + 1)}
          >下一页</button>
        </div>
      </section>

      {selected && (
        <ReasonDialog
          title="安全重试失败任务"
          onClose={() => setSelected(null)}
          onSubmit={retry}
        />
      )}
    </section>
  );
}

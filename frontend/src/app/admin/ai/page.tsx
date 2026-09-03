'use client';

import { useCallback, useEffect, useState } from 'react';

import styles from '../admin.module.scss';
import ReasonDialog from '../components/ReasonDialog';
import { adminFetch, adminPost } from '../lib/adminApi';
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

const emptyPagination: Pagination = { page: 1, limit: 20, total: 0, hasNext: false };

const percentage = (numerator: number, denominator: number): string => (
  denominator === 0 ? '数据积累中' : `${Math.round((numerator / denominator) * 100)}%`
);

const groupTokens = (group: UsageGroup): string => {
  if (group.inputTokens === null || group.outputTokens === null) return '数据积累中';
  return String(group.inputTokens + group.outputTokens);
};

const groupCost = (group: UsageGroup): string => (
  group.estimatedCostMicros === null
    ? '数据积累中'
    : `¥${(group.estimatedCostMicros / 1_000_000).toFixed(2)}`
);

export default function AiPage() {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityError, setIdentityError] = useState('');

  const [range, setRange] = useState<UsageRange>('30d');
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState('');

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
    setUsageLoading(true);
    setUsageError('');
    try {
      setUsage(await adminFetch<AiUsage>(`/api/admin/ai/usage?range=${targetRange}`));
    } catch (error: unknown) {
      setUsage(null);
      setUsageError(error instanceof Error ? error.message : '用量加载失败');
    } finally {
      setUsageLoading(false);
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
  useEffect(() => { void loadUsage(range); }, [loadUsage, range]);
  useEffect(() => { void loadFailures(failurePage); }, [failurePage, loadFailures]);

  const canRetry = admin?.role === 'owner' || admin?.role === 'operator';

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
    setRetryResult(`重试结果：${result.retryStatus}`);
  }

  return (
    <section>
      <h2>AI 使用与异常</h2>

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

      <section aria-labelledby="ai-usage-title">
        <h3 id="ai-usage-title">AI 用量</h3>
        <div className={styles.toolbar} aria-label="AI 用量时间范围">
          <button type="button" aria-pressed={range === '7d'} onClick={() => setRange('7d')}>7 天</button>
          <button type="button" aria-pressed={range === '30d'} onClick={() => setRange('30d')}>30 天</button>
        </div>
        {usageLoading && <p>加载 AI 用量中…</p>}
        {usageError && (
          <div>
            <p role="alert" aria-label="AI 用量错误" className={styles.error}>{usageError}</p>
            <button type="button" onClick={() => void loadUsage(range)}>重新加载 AI 用量</button>
          </div>
        )}
        {!usageLoading && !usageError && usage?.groups.length === 0 && <p>暂无 AI 用量</p>}
        {usage && usage.groups.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th><th>操作</th><th>调用</th><th>成功率</th>
                  <th>Token</th><th>Token 覆盖</th><th>成本</th><th>成本覆盖</th>
                </tr>
              </thead>
              <tbody>
                {usage.groups.map((group) => (
                  <tr key={`${group.provider}-${group.operation}`}>
                    <td>{group.provider}</td>
                    <td>{group.operation}</td>
                    <td>{group.calls}</td>
                    <td>{percentage(group.succeeded, group.calls)}</td>
                    <td>{groupTokens(group)}</td>
                    <td>{percentage(group.knownTokenCalls, group.succeeded)}</td>
                    <td>{groupCost(group)}</td>
                    <td>{percentage(group.costKnownCalls, group.succeeded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="ai-failures-title">
        <h3 id="ai-failures-title">失败富化任务</h3>
        {failuresLoading && <p>加载失败任务中…</p>}
        {failuresError && (
          <div>
            <p role="alert" aria-label="失败任务错误" className={styles.error}>{failuresError}</p>
            <button type="button" onClick={() => void loadFailures(failurePage)}>重新加载失败任务</button>
          </div>
        )}
        {retryResult && <p role="status">{retryResult}</p>}
        {!failuresLoading && !failuresError && failures.items.length === 0 && <p>暂无失败任务</p>}
        <ul className={styles.list}>
          {failures.items.map((item) => (
            <li key={`${item.noteId}-${item.artifact}`}>
              <span>
                {item.noteId} · {item.artifact} · revision {item.currentRevision} ·{' '}
                {item.errorCode ?? '未知错误'}
              </span>
              {canRetry && (
                <button type="button" onClick={() => setSelected(item)}>安全重试</button>
              )}
            </li>
          ))}
        </ul>
        <div className={styles.toolbar} aria-label="失败任务分页">
          <span>第 {failures.pagination.page} 页</span>
          <button
            type="button"
            aria-label="上一页失败任务"
            disabled={failures.pagination.page <= 1 || failuresLoading}
            onClick={() => setFailurePage(failures.pagination.page - 1)}
          >上一页</button>
          <button
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

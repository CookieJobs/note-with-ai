'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import styles from '../admin.module.scss';
import { adminFetch } from '../lib/adminApi';
import { actionLabel, auditStatusLabels, formatDateTime } from '../lib/presentation';
import type { Audit, AuditMetadataValue, AuditStatus, ListResponse, Pagination } from '../lib/contracts';

type AuditFilters = {
  actorId: string;
  action: string;
  status: '' | AuditStatus;
  from: string;
  to: string;
  page: number;
};

const initialFilters: AuditFilters = {
  actorId: '',
  action: '',
  status: '',
  from: '',
  to: '',
  page: 1,
};
const emptyPagination: Pagination = { page: 1, limit: 20, total: 0, hasNext: false };
const safeMetadataKeys = [
  'reason', 'outcome', 'permission', 'status', 'previousStatus', 'nextStatus',
  'changedFields', 'sourceRevision', 'idempotent', 'count', 'retryStatus',
] as const;

function auditUrl(filters: AuditFilters): string {
  const params = new URLSearchParams({ page: String(filters.page), limit: '20' });
  if (filters.actorId) params.set('actorId', filters.actorId);
  if (filters.action) params.set('action', filters.action);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return `/api/admin/audit?${params.toString()}`;
}

function safeMetadata(metadata: Record<string, unknown>): Array<[string, AuditMetadataValue]> {
  const values: Array<[string, AuditMetadataValue]> = [];
  for (const key of safeMetadataKeys) {
    const value = metadata[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (typeof value !== 'string' || value.length <= 256) {
        values.push([key, value as AuditMetadataValue]);
      }
    }
  }
  return values;
}

export default function AuditPage() {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState<ListResponse<Audit>>({
    items: [],
    pagination: emptyPagination,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextFilters: AuditFilters) => {
    setLoading(true);
    setError('');
    try {
      setResult(await adminFetch<ListResponse<Audit>>(auditUrl(nextFilters)));
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(initialFilters); }, [load]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters = { ...draft, page: 1 };
    setFilters(nextFilters);
    void load(nextFilters);
  }

  function changePage(page: number) {
    const nextFilters = { ...filters, page };
    setFilters(nextFilters);
    void load(nextFilters);
  }

  const { items, pagination } = result;
  return (
    <section>
      <header className={styles.pageHeader}>
        <div>
          <h2>操作审计</h2>
          <p className={styles.pageDescription}>追溯管理员操作与执行结果，记录仅供查看。</p>
        </div>
      </header>
      <form className={styles.filterForm} onSubmit={submit}>
        <label className={styles.field}>
          操作者 ID
          <input
          placeholder="输入管理员 ID"
          aria-label="操作者筛选"
          value={draft.actorId}
          onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
        />
        </label>
        <label className={`${styles.field} ${styles.searchField}`}>
          操作标识
          <input
          placeholder="例如 user.status_changed"
          aria-label="动作筛选"
          value={draft.action}
          onChange={(event) => setDraft({ ...draft, action: event.target.value })}
        />
        </label>
        <label className={styles.field}>
          执行状态
          <select
          aria-label="审计状态筛选"
          value={draft.status}
          onChange={(event) => setDraft({
            ...draft,
            status: event.target.value as AuditFilters['status'],
          })}
        >
          <option value="">全部状态</option>
          <option value="pending">待确认</option>
          <option value="succeeded">已成功</option>
          <option value="failed">已失败</option>
          </select>
        </label>
        <label className={styles.field}>
          操作开始日期
          <input
          aria-label="审计开始日期"
          type="date"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
        </label>
        <label className={styles.field}>
          操作结束日期
          <input
          aria-label="审计结束日期"
          type="date"
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
        </label>
        <button className={styles.primaryButton} type="submit" disabled={loading}>筛选</button>
      </form>
      <p className={styles.muted}>待确认：操作的最终执行结果需要人工核实。</p>

      {loading && <p role="status">加载审计中…</p>}
      {error && (
        <div>
          <p role="alert" className={styles.error}>{error}</p>
          <button type="button" onClick={() => void load(filters)}>重新加载审计</button>
        </div>
      )}
      {!error && items.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>操作时间</th><th>操作者</th><th>操作</th><th>执行状态</th><th>目标</th><th>操作详情</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time></td>
                  <td>{item.actor.displayName || '系统'}</td>
                  <td>{actionLabel(item.action)}<span className={`${styles.metadata} ${styles.muted} ${styles.mono}`}>{item.action}</span></td>
                  <td><span className={`${styles.statusBadge} ${item.status === 'succeeded' ? styles.statusGood : item.status === 'failed' ? styles.statusDanger : styles.statusWarning}`}>{auditStatusLabels[item.status] ?? item.status}</span></td>
                  <td><span>{({ User: '用户', Note: '笔记', UserFeedback: '反馈' } as Record<string, string>)[item.targetType ?? ''] ?? item.targetType ?? '无目标'}</span><span className={`${styles.metadata} ${styles.mono}`}>{item.targetId ?? '—'}</span></td>
                  <td>
                    {safeMetadata(item.metadata).map(([key, value]) => (
                      <span className={styles.metadata} key={key}>{key}: {String(value)}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && items.length === 0 && <div className={styles.emptyState}><h3>暂无审计记录</h3><p>当前条件下没有操作记录，请调整操作者或日期范围。</p></div>}
      <div className={styles.pagination} aria-label="审计分页">
        <span>第 {pagination.page} 页 · 共 {pagination.total} 条</span>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={pagination.page <= 1 || loading}
          onClick={() => changePage(pagination.page - 1)}
        >上一页</button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={!pagination.hasNext || loading}
          onClick={() => changePage(pagination.page + 1)}
        >下一页</button>
      </div>
    </section>
  );
}

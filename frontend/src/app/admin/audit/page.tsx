'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import styles from '../admin.module.scss';
import { adminFetch } from '../lib/adminApi';
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
      <h2>操作审计</h2>
      <form className={styles.toolbar} onSubmit={submit}>
        <input
          aria-label="操作者筛选"
          value={draft.actorId}
          onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
        />
        <input
          aria-label="动作筛选"
          value={draft.action}
          onChange={(event) => setDraft({ ...draft, action: event.target.value })}
        />
        <select
          aria-label="审计状态筛选"
          value={draft.status}
          onChange={(event) => setDraft({
            ...draft,
            status: event.target.value as AuditFilters['status'],
          })}
        >
          <option value="">全部状态</option>
          <option value="pending">pending</option>
          <option value="succeeded">succeeded</option>
          <option value="failed">failed</option>
        </select>
        <input
          aria-label="审计开始日期"
          type="date"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
        <input
          aria-label="审计结束日期"
          type="date"
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
        <button type="submit" disabled={loading}>筛选</button>
      </form>
      <p className={styles.muted}>审计记录只读；pending 表示命令状态需要人工确认。</p>

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
              <tr><th>操作者</th><th>动作</th><th>状态</th><th>目标</th><th>安全元数据</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.actor.displayName || '系统'}</td>
                  <td>{item.action}</td>
                  <td>{item.status === 'pending' ? 'pending（状态待人工确认）' : item.status}</td>
                  <td>{item.targetType ?? '—'}:{item.targetId ?? '—'}</td>
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
      {!loading && !error && items.length === 0 && <p>暂无审计记录</p>}
      <div className={styles.toolbar} aria-label="审计分页">
        <span>第 {pagination.page} 页 · 共 {pagination.total} 条</span>
        <button
          type="button"
          disabled={pagination.page <= 1 || loading}
          onClick={() => changePage(pagination.page - 1)}
        >上一页</button>
        <button
          type="button"
          disabled={!pagination.hasNext || loading}
          onClick={() => changePage(pagination.page + 1)}
        >下一页</button>
      </div>
    </section>
  );
}

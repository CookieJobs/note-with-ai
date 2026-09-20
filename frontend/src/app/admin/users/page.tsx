'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import styles from '../admin.module.scss';
import { adminFetch } from '../lib/adminApi';
import type { AdminUser, ListResponse, Pagination } from '../lib/contracts';

type UserFilters = {
  query: string;
  status: '' | 'active' | 'disabled';
  createdFrom: string;
  createdTo: string;
  page: number;
};

const initialFilters: UserFilters = {
  query: '',
  status: '',
  createdFrom: '',
  createdTo: '',
  page: 1,
};

const emptyPagination: Pagination = { page: 1, limit: 20, total: 0, hasNext: false };

function usersUrl(filters: UserFilters): string {
  const params = new URLSearchParams({ page: String(filters.page), limit: '20' });
  if (filters.query) params.set('query', filters.query);
  if (filters.status) params.set('status', filters.status);
  if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters.createdTo) params.set('createdTo', filters.createdTo);
  return `/api/admin/users?${params.toString()}`;
}

export default function UsersPage() {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState<ListResponse<AdminUser>>({
    items: [],
    pagination: emptyPagination,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextFilters: UserFilters) => {
    setLoading(true);
    setError('');
    try {
      setResult(await adminFetch<ListResponse<AdminUser>>(usersUrl(nextFilters)));
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
          <h2>用户管理</h2>
          <p className={styles.pageDescription}>查找用户，查看账户状态与使用情况。</p>
        </div>
      </header>
      <form className={styles.filterForm} onSubmit={submit}>
        <label className={`${styles.field} ${styles.searchField}`}>
          搜索用户
          <input
          aria-label="搜索用户"
          value={draft.query}
          placeholder="邮箱、ID 或用户名"
          onChange={(event) => setDraft({ ...draft, query: event.target.value })}
        />
        </label>
        <label className={styles.field}>
          账户状态
          <select
          aria-label="用户状态"
          value={draft.status}
          onChange={(event) => setDraft({
            ...draft,
            status: event.target.value as UserFilters['status'],
          })}
        >
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">已禁用</option>
          </select>
        </label>
        <label className={styles.field}>
          注册开始日期
          <input
            aria-label="用户创建开始日期"
            type="date"
            value={draft.createdFrom}
            onChange={(event) => setDraft({ ...draft, createdFrom: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          注册结束日期
          <input
            aria-label="用户创建结束日期"
            type="date"
            value={draft.createdTo}
            onChange={(event) => setDraft({ ...draft, createdTo: event.target.value })}
          />
        </label>
        <button className={styles.primaryButton} type="submit" disabled={loading}>搜索</button>
      </form>

      {loading && <p role="status">加载用户中…</p>}
      {error && (
        <div>
          <p role="alert" className={styles.error}>{error}</p>
          <button type="button" onClick={() => void load(filters)}>重新加载用户</button>
        </div>
      )}

      {!error && items.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>用户名</th><th>邮箱</th><th>状态</th><th className={styles.numeric}>笔记数</th><th className={styles.numeric}>AI 调用 · 30 天</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><a className={styles.textLink} href={`/admin/users/${item.id}`}>{item.username}</a><span className={`${styles.metadata} ${styles.muted} ${styles.mono}`}>{item.id}</span></td>
                  <td>{item.maskedEmail}</td>
                  <td><span className={`${styles.statusBadge} ${item.isActive ? styles.statusGood : styles.statusDanger}`}>{item.isActive ? '正常' : '已禁用'}</span></td>
                  <td className={styles.numeric}>{item.noteCount.toLocaleString()}</td>
                  <td className={styles.numeric}>{item.aiCalls30d.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && items.length === 0 && <div className={styles.emptyState}><h3>暂无用户</h3><p>当前条件下没有匹配用户，请调整搜索词或注册日期。</p></div>}

      <div className={styles.pagination} aria-label="用户列表分页">
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

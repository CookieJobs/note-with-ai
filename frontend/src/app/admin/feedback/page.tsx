'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import styles from '../admin.module.scss';
import { adminFetch, adminPatch } from '../lib/adminApi';
import type {
  AdminIdentity,
  Feedback,
  FeedbackCategory,
  FeedbackStatus,
  ListResponse,
  Pagination,
} from '../lib/contracts';

type FeedbackFilters = {
  status: '' | FeedbackStatus;
  category: '' | FeedbackCategory;
  userId: string;
  assignedToSelf: boolean;
  from: string;
  to: string;
  page: number;
};

type FeedbackEdit = {
  status: FeedbackStatus;
  internalNote: string;
  assignedToSelf: boolean;
};

const statuses: FeedbackStatus[] = ['open', 'in_progress', 'resolved'];
const categories: FeedbackCategory[] = ['bug', 'experience', 'feature', 'billing', 'other'];
const initialFilters: FeedbackFilters = {
  status: '',
  category: '',
  userId: '',
  assignedToSelf: false,
  from: '',
  to: '',
  page: 1,
};
const emptyPagination: Pagination = { page: 1, limit: 20, total: 0, hasNext: false };

function feedbackUrl(filters: FeedbackFilters): string {
  const params = new URLSearchParams({ page: String(filters.page), limit: '20' });
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.assignedToSelf) params.set('assignedToSelf', 'true');
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return `/api/admin/feedback?${params.toString()}`;
}

export default function FeedbackPage() {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState<ListResponse<Feedback>>({
    items: [],
    pagination: emptyPagination,
  });
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [edits, setEdits] = useState<Record<string, FeedbackEdit>>({});
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [success, setSuccess] = useState('');
  const adminIdRef = useRef<string | null>(null);

  const loadFeedback = useCallback(async (nextFilters: FeedbackFilters) => {
    setLoading(true);
    setListError('');
    try {
      const nextResult = await adminFetch<ListResponse<Feedback>>(feedbackUrl(nextFilters));
      setResult(nextResult);
      setEdits(Object.fromEntries(nextResult.items.map((item) => [
        item.id,
        {
          status: item.status,
          internalNote: item.internalNote,
          assignedToSelf: item.assignedTo !== null && item.assignedTo === adminIdRef.current,
        },
      ])));
    } catch (error: unknown) {
      setListError(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void adminFetch<{ admin: AdminIdentity }>('/api/admin/auth/me')
      .then((response) => {
        adminIdRef.current = response.admin.id;
        setAdmin(response.admin);
      })
      .catch(() => setAdmin(null))
      .finally(() => { void loadFeedback(initialFilters); });
  }, [loadFeedback]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters = { ...draft, page: 1 };
    setFilters(nextFilters);
    void loadFeedback(nextFilters);
  }

  function changePage(page: number) {
    const nextFilters = { ...filters, page };
    setFilters(nextFilters);
    void loadFeedback(nextFilters);
  }

  function setEdit(id: string, next: Partial<FeedbackEdit>) {
    setEdits((current) => ({
      ...current,
      [id]: { ...current[id], ...next },
    }));
    setMutationError('');
    setSuccess('');
  }

  async function save(item: Feedback) {
    const edit = edits[item.id];
    if (!edit) return;
    setPendingId(item.id);
    setMutationError('');
    setSuccess('');
    try {
      await adminPatch(`/api/admin/feedback/${item.id}`, edit);
      await loadFeedback(filters);
      setSuccess('反馈已更新');
    } catch (error: unknown) {
      setMutationError(error instanceof Error ? error.message : '更新失败');
    } finally {
      setPendingId(null);
    }
  }

  const writable = admin !== null && admin.role !== 'viewer';
  const { items, pagination } = result;

  return (
    <section>
      <h2>用户反馈</h2>
      <form className={styles.toolbar} onSubmit={submitFilters}>
        <select
          aria-label="反馈状态筛选"
          value={draft.status}
          onChange={(event) => setDraft({
            ...draft,
            status: event.target.value as FeedbackFilters['status'],
          })}
        >
          <option value="">全部状态</option>
          {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select
          aria-label="反馈分类筛选"
          value={draft.category}
          onChange={(event) => setDraft({
            ...draft,
            category: event.target.value as FeedbackFilters['category'],
          })}
        >
          <option value="">全部分类</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <input
          aria-label="反馈用户筛选"
          value={draft.userId}
          placeholder="用户 ID"
          onChange={(event) => setDraft({ ...draft, userId: event.target.value })}
        />
        <label>
          从
          <input
            aria-label="反馈开始日期"
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label>
          至
          <input
            aria-label="反馈结束日期"
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.assignedToSelf}
            onChange={(event) => setDraft({ ...draft, assignedToSelf: event.target.checked })}
          />
          只看分配给我
        </label>
        <button type="submit" disabled={loading}>筛选</button>
      </form>

      {loading && <p role="status">加载反馈中…</p>}
      {listError && (
        <div>
          <p role="alert" className={styles.error}>{listError}</p>
          <button type="button" onClick={() => void loadFeedback(filters)}>重新加载反馈</button>
        </div>
      )}
      {mutationError && <p role="alert" className={styles.error}>{mutationError}</p>}
      {success && <p role="status">{success}</p>}

      {!listError && items.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>时间</th><th>分类</th><th>内容</th><th>状态</th><th>内部备注</th><th>分配</th>
                {writable && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const edit = edits[item.id];
                const pending = pendingId === item.id;
                return (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td>
                    <td>{item.category}</td>
                    <td>{item.content}</td>
                    <td>
                      {writable && edit ? (
                        <select
                          aria-label={`反馈状态 ${item.id}`}
                          value={edit.status}
                          disabled={pending}
                          onChange={(event) => setEdit(item.id, {
                            status: event.target.value as FeedbackStatus,
                          })}
                        >
                          {statuses.map((status) => <option key={status}>{status}</option>)}
                        </select>
                      ) : item.status}
                    </td>
                    <td>
                      {writable && edit ? (
                        <textarea
                          aria-label={`内部备注 ${item.id}`}
                          value={edit.internalNote}
                          maxLength={2000}
                          disabled={pending}
                          onChange={(event) => setEdit(item.id, { internalNote: event.target.value })}
                        />
                      ) : (item.internalNote || '—')}
                    </td>
                    <td>
                      {writable && edit ? (
                        <label>
                          <input
                            aria-label={`分配给我 ${item.id}`}
                            type="checkbox"
                            checked={edit.assignedToSelf}
                            disabled={pending}
                            onChange={(event) => setEdit(item.id, {
                              assignedToSelf: event.target.checked,
                            })}
                          />
                          分配给我
                        </label>
                      ) : (item.assignedTo ? '已分配' : '未分配')}
                    </td>
                    {writable && (
                      <td>
                        <button
                          type="button"
                          aria-label={pending ? `保存中 ${item.id}` : `保存反馈 ${item.id}`}
                          disabled={pending || !edit}
                          onClick={() => void save(item)}
                        >{pending ? '保存中…' : '保存'}</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !listError && items.length === 0 && <p>暂无反馈</p>}

      <div className={styles.toolbar} aria-label="反馈分页">
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

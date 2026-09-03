'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import styles from '../../admin.module.scss';
import ReasonDialog from '../../components/ReasonDialog';
import { adminFetch, adminPost } from '../../lib/adminApi';
import type { AdminIdentity, AdminUser } from '../../lib/contracts';

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [success, setSuccess] = useState('');

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextUser, session] = await Promise.all([
        adminFetch<AdminUser>(`/api/admin/users/${id}`),
        adminFetch<{ admin: AdminIdentity }>('/api/admin/auth/me'),
      ]);
      setUser(nextUser);
      setAdmin(session.admin);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  if (loading && !user) return <p role="status">加载用户中…</p>;
  if (error && !user) {
    return (
      <section>
        <p role="alert" className={styles.error}>{error}</p>
        <button type="button" onClick={() => void loadInitial()}>重新加载用户详情</button>
      </section>
    );
  }
  if (!user || !admin) return null;

  const canWrite = admin.role === 'owner' || admin.role === 'operator';
  const visibleEmail = admin.role === 'viewer' ? user.maskedEmail : (user.email ?? user.maskedEmail);

  async function changeStatus(reason: string) {
    if (!user) return;
    setSuccess('');
    await adminPost(`/api/admin/users/${id}/status`, {
      isActive: !user.isActive,
      reason,
    });
    const canonicalUser = await adminFetch<AdminUser>(`/api/admin/users/${id}`);
    setUser(canonicalUser);
    setDialogOpen(false);
    setSuccess('用户状态已更新');
  }

  return (
    <section>
      <h2>{user.username}</h2>
      {success && <p role="status">{success}</p>}
      <div className={styles.card}>
        <p>邮箱：{visibleEmail}</p>
        <p>状态：{user.isActive ? '正常' : '已禁用'}</p>
        <p>笔记：{user.noteCount} · 聊天：{user.chatCount} · AI：{user.aiCalls30d}</p>
        {canWrite && (
          <button type="button" onClick={() => setDialogOpen(true)}>
            {user.isActive ? '禁用用户' : '恢复用户'}
          </button>
        )}
      </div>
      {dialogOpen && (
        <ReasonDialog
          title={user.isActive ? '禁用用户' : '恢复用户'}
          onClose={() => setDialogOpen(false)}
          onSubmit={changeStatus}
        />
      )}
    </section>
  );
}

'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import styles from '../../admin.module.scss';
import ReasonDialog from '../../components/ReasonDialog';
import { adminFetch, adminPost } from '../../lib/adminApi';
import { formatDateTime } from '../../lib/presentation';
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
      <header className={styles.pageHeader}>
        <div>
          <Link className={styles.textLink} href="/admin/users">返回用户列表</Link>
          <h2>{user.username}</h2>
          <p className={styles.pageDescription}>查看账户资料、使用统计与状态。</p>
        </div>
        <span className={`${styles.statusBadge} ${user.isActive ? styles.statusGood : styles.statusDanger}`}>
          {user.isActive ? '正常' : '已禁用'}
        </span>
      </header>
      {success && <p role="status" className={styles.notice}>{success}</p>}
      <div className={styles.detailGrid}>
        <section className={styles.panel} aria-labelledby="user-profile-title">
          <div className={styles.panelHeader}>
            <h3 id="user-profile-title" className={styles.panelTitle}>账户资料</h3>
          </div>
          <dl className={styles.definitionList}>
            <div><dt>用户 ID</dt><dd className={styles.mono}>{user.id}</dd></div>
            <div><dt>邮箱</dt><dd>{visibleEmail}</dd></div>
            <div><dt>邮箱验证</dt><dd>{user.isVerified ? '已验证' : '未验证'}</dd></div>
            <div><dt>注册时间</dt><dd>{formatDateTime(user.createdAt)}</dd></div>
            <div><dt>最近活跃</dt><dd>{formatDateTime(user.lastActiveAt)}</dd></div>
          </dl>
        </section>
        <section className={styles.panel} aria-labelledby="user-usage-title">
          <div className={styles.panelHeader}>
            <div>
              <h3 id="user-usage-title" className={styles.panelTitle}>使用情况</h3>
              <p className={styles.panelDescription}>AI 调用与已知 Token 统计范围为最近 30 天。</p>
            </div>
          </div>
          <dl className={styles.definitionList}>
            <div><dt>笔记数</dt><dd className={styles.numeric}>{user.noteCount.toLocaleString()}</dd></div>
            <div><dt>聊天数</dt><dd className={styles.numeric}>{user.chatCount.toLocaleString()}</dd></div>
            <div><dt>AI 调用</dt><dd className={styles.numeric}>{user.aiCalls30d.toLocaleString()}</dd></div>
            <div><dt>已知 Token</dt><dd className={styles.numeric}>{user.aiKnownTokens30d.toLocaleString()}</dd></div>
          </dl>
        </section>
      </div>
      {canWrite && (
        <section className={styles.panel} aria-labelledby="user-status-title">
          <div className={styles.panelHeader}>
            <div>
              <h3 id="user-status-title" className={styles.panelTitle}>账户状态管理</h3>
              <p className={styles.panelDescription}>状态变更需要填写原因，操作会记入审计记录。</p>
            </div>
            <button
              className={user.isActive ? styles.dangerButton : styles.primaryButton}
              type="button"
              onClick={() => setDialogOpen(true)}
            >
              {user.isActive ? '禁用用户' : '恢复用户'}
            </button>
          </div>
        </section>
      )}
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

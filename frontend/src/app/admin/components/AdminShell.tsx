'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import styles from '../admin.module.scss';
import { adminFetch, adminPost } from '../lib/adminApi';
import type { AdminIdentity, AdminRole } from '../lib/contracts';

type NavigationItem = {
  key: 'overview' | 'users' | 'ai' | 'feedback' | 'system' | 'audit';
  label: string;
  href: string;
};

const navigationItems: NavigationItem[] = [
  { key: 'overview', label: '概览', href: '/admin' },
  { key: 'users', label: '用户', href: '/admin/users' },
  { key: 'ai', label: 'AI 使用', href: '/admin/ai' },
  { key: 'feedback', label: '反馈', href: '/admin/feedback' },
  { key: 'system', label: '系统', href: '/admin/system' },
  { key: 'audit', label: '审计', href: '/admin/audit' },
];

const visibleNavigation: Record<AdminRole, NavigationItem['key'][]> = {
  owner: ['overview', 'users', 'ai', 'feedback', 'system', 'audit'],
  operator: ['overview', 'users', 'ai', 'feedback', 'system', 'audit'],
  support: ['overview', 'users', 'ai', 'feedback', 'system'],
  viewer: ['overview', 'users', 'ai', 'feedback', 'system'],
};

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  useEffect(() => {
    if (pathname === '/admin/login') {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setForbidden(false);
    void adminFetch<{ admin: AdminIdentity }>('/api/admin/auth/me')
      .then((result) => {
        if (active) setAdmin(result.admin);
      })
      .catch((error: unknown) => {
        if (active && typeof error === 'object' && error !== null && 'status' in error && error.status === 403) {
          setForbidden(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [pathname]);

  async function logout() {
    setLogoutError('');
    try {
      await adminPost('/api/admin/auth/logout');
      router.push('/admin/login');
    } catch {
      setLogoutError('退出失败，请重试');
    }
  }

  if (pathname === '/admin/login') return <>{children}</>;
  if (loading) return <main className={styles.center}>正在验证管理员会话…</main>;
  if (forbidden) {
    return <main className={styles.center}><p role="alert">当前管理员角色无权访问此页面</p></main>;
  }
  if (!admin) return <main className={styles.center}>会话已失效，请重新登录</main>;

  const allowed = visibleNavigation[admin.role];
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <h1>NoteWithAI</h1>
        <p>运营后台</p>
        <p>{admin.displayName} · {admin.role}</p>
        <nav aria-label="运营后台导航">
          {navigationItems
            .filter((item) => allowed.includes(item.key))
            .map((item) => <a key={item.key} href={item.href}>{item.label}</a>)}
        </nav>
        {logoutError && <p role="alert">{logoutError}</p>}
        <button type="button" onClick={() => void logout()}>退出登录</button>
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  );
}

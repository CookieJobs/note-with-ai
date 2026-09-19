'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, ArrowUpRight, BookOpen, LayoutDashboard, LogOut, MessageSquare, ScrollText, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import styles from '../admin.module.scss';
import { adminFetch, adminPost } from '../lib/adminApi';
import type { AdminIdentity, AdminRole } from '../lib/contracts';

const SESSION_VERIFICATION_TIMEOUT_MS = 10_000;

type NavigationItem = {
  key: 'overview' | 'users' | 'ai' | 'feedback' | 'system' | 'audit';
  label: string;
  href: string;
  icon: LucideIcon;
};

const navigationItems: NavigationItem[] = [
  { key: 'overview', label: '概览', href: '/admin', icon: LayoutDashboard },
  { key: 'users', label: '用户', href: '/admin/users', icon: Users },
  { key: 'ai', label: 'AI 使用', href: '/admin/ai', icon: Activity },
  { key: 'feedback', label: '反馈', href: '/admin/feedback', icon: MessageSquare },
  { key: 'system', label: '系统', href: '/admin/system', icon: ShieldCheck },
  { key: 'audit', label: '审计', href: '/admin/audit', icon: ScrollText },
];

const roleLabels: Record<AdminRole, string> = {
  owner: '所有者', operator: '运营管理员', support: '客服', viewer: '只读成员',
};

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
  const [sessionError, setSessionError] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [verificationAttempt, setVerificationAttempt] = useState(0);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), SESSION_VERIFICATION_TIMEOUT_MS);
    setLoading(true);
    setForbidden(false);
    setSessionError('');
    void adminFetch<{ admin: AdminIdentity }>('/api/admin/auth/me', { signal: controller.signal })
      .then((result) => {
        if (active) setAdmin(result.admin);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (typeof error === 'object' && error !== null && 'status' in error && error.status === 403) {
          setForbidden(true);
          return;
        }
        setSessionError(controller.signal.aborted
          ? '验证管理员会话超时，请检查网络后重试'
          : '无法验证管理员会话，请重试');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [pathname, verificationAttempt]);

  async function logout() {
    setLogoutError('');
    try {
      await adminPost('/api/admin/auth/logout');
      router.push('/admin/login');
    } catch {
      setLogoutError('退出失败，请重试');
    }
  }

  function retrySessionVerification() {
    setVerificationAttempt((attempt) => attempt + 1);
  }

  if (pathname === '/admin/login') return <>{children}</>;
  if (loading || sessionError) {
    return (
      <main className={`${styles.adminTheme} ${styles.center}`}>
        <section className={styles.recovery} aria-live="polite">
          {loading && <p role="status">正在验证管理员会话…</p>}
          {sessionError && <p role="alert" className={styles.error}>{sessionError}</p>}
          <div className={styles.recoveryActions}>
            <button type="button" onClick={retrySessionVerification}>重新验证</button>
            <button type="button" onClick={() => router.back()}>返回上一页</button>
            <a href="/admin/login">前往登录页</a>
            <button type="button" onClick={logout}>退出登录</button>
          </div>
          {logoutError && <p role="alert" className={styles.error}>{logoutError}</p>}
        </section>
      </main>
    );
  }
  if (forbidden) {
    return <main className={`${styles.adminTheme} ${styles.center}`}><p role="alert">当前管理员角色无权访问此页面</p></main>;
  }
  if (!admin) return <main className={`${styles.adminTheme} ${styles.center}`}>会话已失效，请重新登录</main>;

  const allowed = visibleNavigation[admin.role];
  const isCurrent = (href: string) => href === '/admin' ? pathname === href : pathname.startsWith(`${href}/`) || pathname === href;
  const currentPage = navigationItems.find((item) => isCurrent(item.href));
  return (
    <div className={`${styles.adminTheme} ${styles.shell}`}>
      <a href="#admin-content" className={styles.skipLink}>跳到主要内容</a>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/admin" aria-label="NoteWithAI 运营后台首页">
          <span className={styles.brandMark}><BookOpen size={20} aria-hidden="true" /></span>
          <span><span className={styles.brandName}>NoteWithAI</span><span className={styles.brandCaption}>运营后台</span></span>
        </Link>
        <span className={styles.navCaption}>工作空间</span>
        <nav aria-label="运营后台导航">
          {navigationItems
            .filter((item) => allowed.includes(item.key))
            .map(({ key, href, label, icon: Icon }) => (
              <Link key={key} href={href} aria-current={isCurrent(href) ? 'page' : undefined}>
                <Icon size={18} aria-hidden="true" /><span>{label}</span>
              </Link>
            ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <Link href="/notes" className={styles.returnLink}>返回笔记应用<ArrowUpRight size={15} aria-hidden="true" /></Link>
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">{admin.displayName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{admin.displayName}</strong><span>{roleLabels[admin.role]}</span></span>
          </div>
          {logoutError && <p role="alert" className={styles.error}>{logoutError}</p>}
          <button type="button" onClick={logout} className={styles.logoutButton}><LogOut size={16} aria-hidden="true" />退出登录</button>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <span>工作空间<span className={styles.breadcrumbDivider}>/</span><strong>{currentPage?.label ?? '后台'}</strong></span>
          <span className={styles.topbarNote}>NoteWithAI 管理中心</span>
        </header>
        <main id="admin-content" tabIndex={-1} className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

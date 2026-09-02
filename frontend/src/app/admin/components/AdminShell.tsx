'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adminFetch } from '../lib/adminApi';
import type { AdminIdentity, AdminRole } from '../lib/contracts';
import styles from '../admin.module.scss';
const permissions: Record<AdminRole, string[]> = { owner: ['overview','users','ai','feedback','system','audit'], operator: ['overview','users','ai','feedback','system','audit'], support: ['overview','users','ai','feedback','system'], viewer: ['overview','users','ai','feedback','system'] };
export default function AdminShell({ children }: { children: React.ReactNode }) { const path = usePathname(); const router = useRouter(); const [admin, setAdmin] = useState<AdminIdentity | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { if (path === '/admin/login') { setLoading(false); return; } adminFetch<{ admin: AdminIdentity }>('/api/admin/auth/me').then((r) => setAdmin(r.admin)).catch(() => {}).finally(() => setLoading(false)); }, [path]);
  if (path === '/admin/login') return <>{children}</>; if (loading) return <main className={styles.center}>正在验证管理员会话…</main>; if (!admin) return <main className={styles.center}>会话已失效，请重新登录</main>;
  const allowed = permissions[admin.role]; return <div className={styles.shell}><aside className={styles.sidebar}><h1>NoteWithAI</h1><p>{admin.displayName} · {admin.role}</p><nav>{[['overview','概览','/admin'],['users','用户','/admin/users'],['ai','AI 使用','/admin/ai'],['feedback','反馈','/admin/feedback'],['system','系统','/admin/system'],['audit','审计','/admin/audit']].filter(([key]) => allowed.includes(key)).map(([key,label,href]) => <a key={key} href={href}>{label}</a>)}</nav><button onClick={async () => { await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'include' }); router.push('/admin/login'); }}>退出</button></aside><main className={styles.content}>{children}</main></div>;
}

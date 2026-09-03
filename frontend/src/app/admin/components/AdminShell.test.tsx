import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import type { AdminIdentity, AdminRole } from '../lib/contracts';
import AdminShell from './AdminShell';

const navigation = vi.hoisted(() => ({ pathname: '/admin', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

const identity = (role: AdminRole): AdminIdentity => ({
  id: `admin-${role}`,
  email: `${role}@example.com`,
  displayName: role,
  role,
});

describe('AdminShell', () => {
  beforeEach(() => {
    navigation.pathname = '/admin';
    navigation.push.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows a session loading state before rendering protected content', async () => {
    let resolveSession!: (value: { admin: AdminIdentity }) => void;
    vi.spyOn(api, 'adminFetch').mockImplementation(
      () => new Promise((resolve) => { resolveSession = resolve as typeof resolveSession; }),
    );
    render(<AdminShell><div>受保护内容</div></AdminShell>);

    expect(screen.getByText('正在验证管理员会话…')).toBeInTheDocument();
    expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
    resolveSession({ admin: identity('owner') });
    expect(await screen.findByText('受保护内容')).toBeInTheDocument();
  });

  it.each([
    ['owner', ['概览', '用户', 'AI 使用', '反馈', '系统', '审计']],
    ['operator', ['概览', '用户', 'AI 使用', '反馈', '系统', '审计']],
    ['support', ['概览', '用户', 'AI 使用', '反馈', '系统']],
    ['viewer', ['概览', '用户', 'AI 使用', '反馈', '系统']],
  ] as const)('renders the exact navigation allowed for %s', async (role, labels) => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue({ admin: identity(role) });
    render(<AdminShell><div>内容</div></AdminShell>);

    const nav = await screen.findByRole('navigation', { name: '运营后台导航' });
    const routeByLabel: Record<string, string> = {
      概览: '/admin',
      用户: '/admin/users',
      'AI 使用': '/admin/ai',
      反馈: '/admin/feedback',
      系统: '/admin/system',
      审计: '/admin/audit',
    };
    expect(Array.from(nav.querySelectorAll('a')).map((link) => ({
      label: link.textContent,
      href: link.getAttribute('href'),
    }))).toEqual(labels.map((label) => ({ label, href: routeByLabel[label] })));
  });

  it('shows a 403 inline and does not render protected content', async () => {
    vi.spyOn(api, 'adminFetch').mockRejectedValue({ status: 403 });
    const post = vi.spyOn(api, 'adminPost');
    render(<AdminShell><div>内容</div></AdminShell>);

    expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
    expect(screen.queryByText('内容')).not.toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('logs out through the admin API and returns to the admin login', async () => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue({ admin: identity('owner') });
    const post = vi.spyOn(api, 'adminPost').mockResolvedValue(undefined);
    render(<AdminShell><div>内容</div></AdminShell>);

    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/auth/logout'));
    expect(navigation.push).toHaveBeenCalledWith('/admin/login');
  });

  it('does not request a session around the login page', () => {
    navigation.pathname = '/admin/login';
    const fetch = vi.spyOn(api, 'adminFetch');
    render(<AdminShell><div>登录表单</div></AdminShell>);

    expect(screen.getByText('登录表单')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

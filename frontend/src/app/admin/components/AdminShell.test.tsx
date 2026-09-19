import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import type { AdminIdentity, AdminRole } from '../lib/contracts';
import AdminShell from './AdminShell';

const navigation = vi.hoisted(() => ({ pathname: '/admin', back: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ back: navigation.back, push: navigation.push }),
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
    navigation.back.mockReset();
    navigation.push.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it('keeps recovery controls available while session verification is pending', () => {
    vi.spyOn(api, 'adminFetch').mockImplementation(() => new Promise(() => undefined));
    render(<AdminShell><div>受保护内容</div></AdminShell>);

    expect(screen.getByRole('status')).toHaveTextContent('正在验证管理员会话…');
    expect(screen.getByRole('button', { name: '重新验证' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }));
    expect(navigation.back).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: '前往登录页' })).toHaveAttribute('href', '/admin/login');
  });

  it('ends a hung session verification with a recoverable timeout state', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'adminFetch').mockImplementation(((_url, options?: RequestInit) => new Promise((_, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof api.adminFetch);
    render(<AdminShell><div>受保护内容</div></AdminShell>);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByRole('alert')).toHaveTextContent('验证管理员会话超时，请检查网络后重试');
    expect(screen.getByRole('button', { name: '重新验证' })).toBeEnabled();
    vi.useRealTimers();
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

  it('keeps the logout action available to an authenticated administrator', async () => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue({ admin: identity('owner') });
    render(<AdminShell><div>内容</div></AdminShell>);

    expect(await screen.findByRole('button', { name: '退出登录' })).toBeEnabled();
  });

  it('does not request a session around the login page', () => {
    navigation.pathname = '/admin/login';
    const fetch = vi.spyOn(api, 'adminFetch');
    render(<AdminShell><div>登录表单</div></AdminShell>);

    expect(screen.getByText('登录表单')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the users section selected on a user detail page', async () => {
    navigation.pathname = '/admin/users/user-123';
    vi.spyOn(api, 'adminFetch').mockResolvedValue({ admin: identity('owner') });
    render(<AdminShell><div>用户详情</div></AdminShell>);

    const nav = await screen.findByRole('navigation', { name: '运营后台导航' });
    const selected = nav.querySelectorAll('[aria-current="page"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute('href', '/admin/users');
    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute('href', '#admin-content');
  });
});

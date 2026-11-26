import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import type { AdminIdentity, AdminRole, AdminUser, ListResponse, NoteDiscoveryAccess } from '../lib/contracts';
import UserDetailPage from './[id]/page';
import UsersPage from './page';

const route = vi.hoisted(() => ({ id: 'user-1' }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: route.id }),
}));

const user: AdminUser = {
  id: 'user-1',
  username: 'alice',
  maskedEmail: 'a***e@example.com',
  email: 'alice@example.com',
  isActive: true,
  isVerified: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  lastActiveAt: '2026-09-01T00:00:00.000Z',
  noteCount: 2,
  chatCount: 3,
  aiCalls30d: 4,
  aiKnownTokens30d: 50,
};

const listResult = (
  items: AdminUser[] = [user],
  page = 1,
  hasNext = false,
): ListResponse<AdminUser> => ({
  items,
  pagination: { page, limit: 20, total: hasNext ? 21 : items.length, hasNext },
});

const admin = (role: AdminRole): { admin: AdminIdentity } => ({
  admin: {
    id: `admin-${role}`,
    email: `${role}@example.com`,
    displayName: role,
    role,
  },
});

function requestedUrl(call: unknown[]): URL {
  return new URL(String(call[0]), 'http://localhost');
}

const discoveryEndpoint = '/api/admin/users/user-1/note-discovery-access';
const unopened: NoteDiscoveryAccess = { granted: false, environment: { enabled: false, configured: false, runnable: false } };

function mockDetail(role: AdminRole, rows: AdminUser[] = [user]) {
  let detailRequest = 0;
  return vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
    if (url === '/api/admin/auth/me') return Promise.resolve(admin(role));
    if (url === discoveryEndpoint) return Promise.resolve(unopened);
    if (url === '/api/admin/users/user-1') {
      const value = rows[Math.min(detailRequest, rows.length - 1)];
      detailRequest += 1;
      return Promise.resolve(value);
    }
    return Promise.reject(new Error(`unexpected URL: ${url}`));
  });
}

describe('UsersPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps search as a draft and submits query, status, and created dates together', async () => {
    const fetch = vi.spyOn(api, 'adminFetch').mockResolvedValue(listResult());
    render(<UsersPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('搜索用户'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('用户状态'), { target: { value: 'disabled' } });
    fireEvent.change(screen.getByLabelText('用户创建开始日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('用户创建结束日期'), { target: { value: '2026-09-01' } });
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const url = requestedUrl(fetch.mock.calls[1]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '1',
      limit: '20',
      query: 'alice',
      status: 'disabled',
      createdFrom: '2026-08-01',
      createdTo: '2026-09-01',
    });
  });

  it('paginates the submitted filters with the canonical nested pagination state', async () => {
    const fetch = vi.spyOn(api, 'adminFetch')
      .mockResolvedValueOnce(listResult([user], 1, true))
      .mockResolvedValueOnce(listResult([user], 1, true));
    render(<UsersPage />);
    await screen.findByText('alice');

    fireEvent.change(screen.getByLabelText('搜索用户'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    fetch.mockResolvedValueOnce(listResult([], 2, false));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const url = requestedUrl(fetch.mock.calls[2]);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('query')).toBe('alice');
  });

  it('renders loading, error with recovery, and explicit empty states', async () => {
    const fetch = vi.spyOn(api, 'adminFetch')
      .mockRejectedValueOnce(new Error('用户列表不可用'))
      .mockResolvedValueOnce(listResult([]));
    render(<UsersPage />);

    expect(screen.getByText('加载用户中…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('用户列表不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新加载用户' }));
    expect(await screen.findByText('暂无用户')).toBeInTheDocument();
  });
});

describe('UserDetailPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the detail loading state visible until both user and role arrive', async () => {
    let resolveUser!: (value: AdminUser) => void;
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(admin('owner'));
      return new Promise((resolve) => { resolveUser = resolve as typeof resolveUser; });
    });
    render(<UserDetailPage />);

    expect(screen.getByText('加载用户中…')).toBeInTheDocument();
    resolveUser(user);
    expect(await screen.findByText('alice')).toBeInTheDocument();
  });

  it('never displays a malicious exact email returned for a viewer', async () => {
    mockDetail('viewer', [{
      ...user,
      email: 'should-never-render@example.com',
      maskedEmail: 's***r@example.com',
    }]);
    render(<UserDetailPage />);

    expect(await screen.findByText(/s\*\*\*r@example.com/)).toBeInTheDocument();
    expect(screen.queryByText(/should-never-render@example.com/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '禁用用户' })).not.toBeInTheDocument();
  });

  it.each([
    ['owner', true],
    ['operator', true],
    ['support', false],
    ['viewer', false],
  ] as const)('shows the status action for %s according to the permission matrix', async (role, allowed) => {
    mockDetail(role);
    render(<UserDetailPage />);
    await screen.findByText('alice');

    if (allowed) expect(screen.getByRole('button', { name: '禁用用户' })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: '禁用用户' })).not.toBeInTheDocument();
  });

  it('opens and revokes trial with a reason and renders the server-confirmed state', async () => {
    mockDetail('operator');
    const post = vi.spyOn(api, 'adminPost')
      .mockResolvedValueOnce({ ...unopened, granted: true })
      .mockResolvedValueOnce(unopened);
    render(<UserDetailPage />);
    const panel = await screen.findByRole('region', { name: '笔记发现 Agent' });

    fireEvent.click(await within(panel).findByRole('button', { name: '开放试用' }));
    let dialog = within(panel).getByRole('dialog', { name: '开放笔记发现试用' });
    expect(within(dialog).getByRole('button', { name: '确认' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('原因'), { target: { value: '  邀请用户体验发现功能  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认' }));
    expect(post).toHaveBeenNthCalledWith(1, discoveryEndpoint, { granted: true, reason: '邀请用户体验发现功能' });
    expect(await within(panel).findByText('已开放')).toBeInTheDocument();
    expect(within(panel).getByText('环境总开关已关闭')).toBeInTheDocument();
    expect(within(panel).getByText('试用权限可先保存，用户入口在环境配置就绪后可见。')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '撤销试用' }));
    dialog = within(panel).getByRole('dialog', { name: '撤销笔记发现试用' });
    fireEvent.change(within(dialog).getByLabelText('原因'), { target: { value: '本次试用已结束' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认' }));
    expect(post).toHaveBeenNthCalledWith(2, discoveryEndpoint, { granted: false, reason: '本次试用已结束' });
    expect(await within(panel).findByText('未开放')).toBeInTheDocument();
  });

  it.each(['support', 'viewer'] as const)('shows trial status without controls for %s', async (role) => {
    mockDetail(role);
    render(<UserDetailPage />);
    const panel = within(await screen.findByRole('region', { name: '笔记发现 Agent' }));
    expect(await panel.findByText('未开放')).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '开放试用' })).not.toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '撤销试用' })).not.toBeInTheDocument();
  });

  it('preserves the trial dialog and allows retry after a rejected write', async () => {
    mockDetail('owner');
    const post = vi.spyOn(api, 'adminPost').mockRejectedValueOnce(new Error('权限更新失败'))
      .mockResolvedValueOnce({ ...unopened, granted: true });
    render(<UserDetailPage />);
    const panel = within(await screen.findByRole('region', { name: '笔记发现 Agent' }));
    fireEvent.click(await panel.findByRole('button', { name: '开放试用' }));
    const dialog = within(panel.getByRole('dialog'));
    const reason = dialog.getByLabelText('原因');
    fireEvent.change(reason, { target: { value: '邀请用户体验发现功能' } });
    fireEvent.click(dialog.getByRole('button', { name: '确认' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('权限更新失败');
    expect(panel.getByText('未开放')).toBeInTheDocument();
    expect(reason).toHaveValue('邀请用户体验发现功能');
    fireEvent.click(dialog.getByRole('button', { name: '确认' }));
    expect(await panel.findByText('已开放')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('aborts the old user access read without projecting it onto the next user', async () => {
    let completeOld!: (value: NoteDiscoveryAccess) => void;
    let oldSignal: AbortSignal | null | undefined;
    vi.spyOn(api, 'adminFetch').mockImplementation((url, options) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(admin('owner'));
      if (url === discoveryEndpoint) {
        oldSignal = options?.signal;
        return new Promise<NoteDiscoveryAccess>(resolve => { completeOld = resolve; });
      }
      if (url.endsWith('/note-discovery-access')) return Promise.resolve(unopened);
      if (url.endsWith('/user-2')) return Promise.resolve({ ...user, id: 'user-2', username: 'bob' });
      return Promise.resolve(user);
    });
    const page = render(<UserDetailPage />);
    await screen.findByText('正在读取试用权限…');
    route.id = 'user-2';
    try {
      page.rerender(<UserDetailPage />);
      expect(await screen.findByText('bob')).toBeInTheDocument();
      expect(oldSignal?.aborted).toBe(true);
      await act(async () => { completeOld({ ...unopened, granted: true }); });
      expect(await screen.findByText('未开放')).toBeInTheDocument();
      expect(screen.queryByText('已开放')).not.toBeInTheDocument();
    } finally {
      route.id = 'user-1';
    }
  });

  it('posts the status body, does not update optimistically, then refetches the canonical detail', async () => {
    const disabledUser = { ...user, isActive: false };
    const fetch = mockDetail('operator', [user, disabledUser]);
    let resolvePost!: (value: unknown) => void;
    const post = vi.spyOn(api, 'adminPost').mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve; }),
    );
    render(<UserDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: '禁用用户' }));
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '违反平台使用规范' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(post).toHaveBeenCalledWith('/api/admin/users/user-1/status', {
      isActive: false,
      reason: '违反平台使用规范',
    });
    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();

    resolvePost({ id: 'user-1', isActive: false, idempotent: false });
    expect(await screen.findByText('已禁用')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('用户状态已更新');
    expect(fetch.mock.calls.filter(([url]) => url === '/api/admin/users/user-1')).toHaveLength(2);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/admin/auth/me')).toHaveLength(1);
  });

  it('retains a visible mutation error and does not refetch after a rejected status change', async () => {
    const fetch = mockDetail('owner');
    vi.spyOn(api, 'adminPost').mockRejectedValue(new Error('状态更新失败'));
    render(<UserDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: '禁用用户' }));
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '违反平台使用规范' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('状态更新失败');
    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => url === '/api/admin/users/user-1')).toHaveLength(1);
  });

  it('recovers from an initial detail error through an explicit retry', async () => {
    let detailCalls = 0;
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(admin('owner'));
      if (url === discoveryEndpoint) return Promise.resolve(unopened);
      detailCalls += 1;
      return detailCalls === 1 ? Promise.reject(new Error('详情不可用')) : Promise.resolve(user);
    });
    render(<UserDetailPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('详情不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新加载用户详情' }));
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(detailCalls).toBe(2);
  });
});

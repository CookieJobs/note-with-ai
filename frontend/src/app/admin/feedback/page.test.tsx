import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import type {
  AdminIdentity,
  AdminRole,
  Feedback,
  ListResponse,
} from '../lib/contracts';
import FeedbackPage from './page';

const feedback: Feedback = {
  id: 'feedback-1',
  status: 'open',
  category: 'bug',
  content: '编辑器无法保存',
  userId: '507f1f77bcf86cd799439011',
  contact: null,
  appVersion: '1.0.0',
  internalNote: '等待复现',
  assignedTo: null,
  resolvedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const result = (
  items: Feedback[] = [feedback],
  page = 1,
  hasNext = false,
): ListResponse<Feedback> => ({
  items,
  pagination: { page, limit: 20, total: hasNext ? 21 : items.length, hasNext },
});

const session = (role: AdminRole): { admin: AdminIdentity } => ({
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

function mockPage(role: AdminRole = 'support', feedbackResult = result()) {
  return vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
    if (url === '/api/admin/auth/me') return Promise.resolve(session(role));
    if (url.startsWith('/api/admin/feedback?')) return Promise.resolve(feedbackResult);
    return Promise.reject(new Error(`unexpected URL: ${url}`));
  });
}

describe('FeedbackPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('submits every filter and preserves them through nested pagination', async () => {
    const fetch = vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(session('support'));
      if (url.includes('page=2')) return Promise.resolve(result([], 2, false));
      return Promise.resolve(result([feedback], 1, true));
    });
    render(<FeedbackPage />);
    await screen.findByText('编辑器无法保存');

    fireEvent.change(screen.getByLabelText('反馈状态筛选'), { target: { value: 'in_progress' } });
    fireEvent.change(screen.getByLabelText('反馈分类筛选'), { target: { value: 'feature' } });
    fireEvent.change(screen.getByLabelText('反馈用户筛选'), { target: { value: feedback.userId } });
    fireEvent.change(screen.getByLabelText('反馈开始日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('反馈结束日期'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByLabelText('只看分配给我'));
    const callsBeforeSubmit = fetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));

    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(callsBeforeSubmit));
    const filteredCall = fetch.mock.calls.find(([url]) => String(url).includes('status=in_progress'));
    expect(filteredCall).toBeDefined();
    expect(Object.fromEntries(requestedUrl(filteredCall!).searchParams)).toEqual({
      page: '1',
      limit: '20',
      status: 'in_progress',
      category: 'feature',
      userId: feedback.userId,
      assignedToSelf: 'true',
      from: '2026-08-01',
      to: '2026-09-01',
    });

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true));
    const pageTwo = fetch.mock.calls.find(([url]) => String(url).includes('page=2'))!;
    expect(requestedUrl(pageTwo).searchParams.get('category')).toBe('feature');
  });

  it('edits status, internal note, and self-assignment with an exact PATCH body and refetch', async () => {
    const fetch = mockPage('support');
    let resolvePatch!: (value: unknown) => void;
    const patch = vi.spyOn(api, 'adminPatch').mockImplementation(
      () => new Promise((resolve) => { resolvePatch = resolve; }),
    );
    render(<FeedbackPage />);
    await screen.findByText('编辑器无法保存');

    fireEvent.change(screen.getByLabelText('反馈状态 feedback-1'), { target: { value: 'resolved' } });
    fireEvent.change(screen.getByLabelText('内部备注 feedback-1'), { target: { value: '已联系用户并修复' } });
    fireEvent.click(screen.getByLabelText('分配给我 feedback-1'));
    fireEvent.click(screen.getByRole('button', { name: '保存反馈 feedback-1' }));
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '已确认用户反馈并完成处理' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(patch).toHaveBeenCalledWith('/api/admin/feedback/feedback-1', {
      status: 'resolved',
      internalNote: '已联系用户并修复',
      assignedToSelf: true,
      reason: '已确认用户反馈并完成处理',
    });
    expect(screen.getByRole('button', { name: '保存中 feedback-1' })).toBeDisabled();
    resolvePatch(feedback);

    expect(await screen.findByText('反馈已更新')).toHaveAttribute('role', 'status');
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/feedback?'))).toHaveLength(2);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/admin/auth/me')).toHaveLength(1);
  });

  it('sends assignedToSelf false when an assigned feedback is cleared', async () => {
    mockPage('operator', result([{ ...feedback, assignedTo: 'admin-operator' }]));
    const patch = vi.spyOn(api, 'adminPatch').mockResolvedValue(feedback);
    render(<FeedbackPage />);
    await screen.findByText('编辑器无法保存');

    fireEvent.click(screen.getByLabelText('分配给我 feedback-1'));
    fireEvent.click(screen.getByRole('button', { name: '保存反馈 feedback-1' }));
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '取消当前分配以便重新处理' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/admin/feedback/feedback-1', {
      status: 'open',
      internalNote: '等待复现',
      assignedToSelf: false,
      reason: '取消当前分配以便重新处理',
    }));
  });

  it('retains edit values and a visible error without refetching after PATCH failure', async () => {
    const fetch = mockPage('owner');
    vi.spyOn(api, 'adminPatch').mockRejectedValue(new Error('反馈更新失败'));
    render(<FeedbackPage />);
    await screen.findByText('编辑器无法保存');

    fireEvent.change(screen.getByLabelText('内部备注 feedback-1'), { target: { value: '保留这段编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存反馈 feedback-1' }));
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '尝试更新内部备注以便跟进' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('反馈更新失败');
    expect(screen.getByLabelText('内部备注 feedback-1')).toHaveValue('保留这段编辑');
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/feedback?'))).toHaveLength(1);
  });

  it('renders viewer feedback as read-only even when internal notes are present', async () => {
    mockPage('viewer');
    render(<FeedbackPage />);

    expect(await screen.findByText('等待复现')).toBeInTheDocument();
    expect(screen.queryByLabelText('内部备注 feedback-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存反馈 feedback-1' })).not.toBeInTheDocument();
  });

  it('renders loading, error recovery, and an explicit empty state', async () => {
    let feedbackCalls = 0;
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(session('support'));
      feedbackCalls += 1;
      return feedbackCalls === 1
        ? Promise.reject(new Error('反馈列表不可用'))
        : Promise.resolve(result([]));
    });
    render(<FeedbackPage />);

    expect(screen.getByText('加载反馈中…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('反馈列表不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新加载反馈' }));
    expect(await screen.findByText('暂无反馈')).toBeInTheDocument();
  });
});

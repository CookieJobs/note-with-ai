import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import type {
  AdminIdentity,
  AdminRole,
  AiUsage,
  FailedArtifact,
  ListResponse,
} from '../lib/contracts';
import AiPage from './page';

const usage: AiUsage = {
  range: '30d',
  groups: [{
    provider: 'deepseek',
    operation: 'chat',
    calls: 2,
    succeeded: 1,
    inputTokens: 10,
    outputTokens: 20,
    knownTokenCalls: 1,
    costKnownCalls: 1,
    estimatedCostMicros: 2_000_000,
  }],
};

const failure: FailedArtifact = {
  noteId: 'note-1',
  userId: 'user-1',
  artifact: 'embedding',
  sourceRevision: 4,
  currentRevision: 4,
  attemptedAt: '2026-09-01T00:00:00.000Z',
  errorCode: 'EMBEDDING_FAILED',
};

const failures = (
  items: FailedArtifact[] = [failure],
  page = 1,
  hasNext = false,
): ListResponse<FailedArtifact> => ({
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

function mockPage(role: AdminRole = 'owner') {
  return vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
    if (url === '/api/admin/auth/me') return Promise.resolve(session(role));
    if (url.startsWith('/api/admin/ai/usage')) return Promise.resolve(usage);
    if (url.startsWith('/api/admin/ai/failures')) return Promise.resolve(failures());
    return Promise.reject(new Error(`unexpected URL: ${url}`));
  });
}

describe('AiPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows independent loading states while all three requests are pending', () => {
    vi.spyOn(api, 'adminFetch').mockImplementation(() => new Promise(() => undefined));
    render(<AiPage />);

    expect(screen.getByText('正在确认重试权限…')).toBeInTheDocument();
    expect(screen.getByText('加载 AI 用量中…')).toBeInTheDocument();
    expect(screen.getByText('加载失败任务中…')).toBeInTheDocument();
  });

  it('loads identity, usage, and failures independently', async () => {
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return new Promise(() => undefined);
      if (url.startsWith('/api/admin/ai/usage')) return Promise.resolve(usage);
      return Promise.resolve(failures());
    });
    render(<AiPage />);

    expect(await screen.findByText('deepseek')).toBeInTheDocument();
    expect(screen.getByText(/note-1/)).toBeInTheDocument();
    expect(screen.getByText('正在确认重试权限…')).toBeInTheDocument();
    expect(screen.queryByText('加载 AI 用量中…')).not.toBeInTheDocument();
    expect(screen.queryByText('加载失败任务中…')).not.toBeInTheDocument();
  });

  it('keeps failure data usable when the usage request fails', async () => {
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(session('owner'));
      if (url.startsWith('/api/admin/ai/usage')) return Promise.reject(new Error('用量不可用'));
      return Promise.resolve(failures());
    });
    render(<AiPage />);

    expect(await screen.findByRole('alert', { name: 'AI 用量错误' })).toHaveTextContent('用量不可用');
    expect(screen.getByText(/note-1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载 AI 用量' })).toBeInTheDocument();
  });

  it('keeps usage and failure data visible when identity loading fails', async () => {
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.reject(new Error('身份不可用'));
      if (url.startsWith('/api/admin/ai/usage')) return Promise.resolve(usage);
      return Promise.resolve(failures());
    });
    render(<AiPage />);

    expect(await screen.findByRole('alert', { name: '管理员身份错误' })).toHaveTextContent('身份不可用');
    expect(screen.getByText('deepseek')).toBeInTheDocument();
    expect(screen.getByText(/note-1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安全重试' })).not.toBeInTheDocument();
  });

  it('keeps usage data usable when the failure request fails', async () => {
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(session('owner'));
      if (url.startsWith('/api/admin/ai/usage')) return Promise.resolve(usage);
      return Promise.reject(new Error('失败任务不可用'));
    });
    render(<AiPage />);

    expect(await screen.findByRole('alert', { name: '失败任务错误' })).toHaveTextContent('失败任务不可用');
    expect(screen.getByText('deepseek')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载失败任务' })).toBeInTheDocument();
  });

  it('renders explicit empty states for both usage and failures', async () => {
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(session('viewer'));
      if (url.startsWith('/api/admin/ai/usage')) return Promise.resolve({ ...usage, groups: [] });
      return Promise.resolve(failures([]));
    });
    render(<AiPage />);

    expect(await screen.findByText('暂无 AI 用量')).toBeInTheDocument();
    expect(screen.getByText('暂无失败任务')).toBeInTheDocument();
  });

  it('switches 7d/30d usage without refetching failure pagination', async () => {
    const fetch = mockPage();
    render(<AiPage />);
    await screen.findByText('deepseek');
    expect(screen.getByRole('button', { name: '30 天' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '7 天' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/ai/usage?range=7d'));
    expect(screen.getByRole('button', { name: '7 天' })).toHaveAttribute('aria-pressed', 'true');
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/ai/failures'))).toHaveLength(1);
  });

  it('paginates failures independently with nested pagination', async () => {
    const fetch = vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(session('owner'));
      if (url.startsWith('/api/admin/ai/usage')) return Promise.resolve(usage);
      if (url.endsWith('page=1&limit=20')) return Promise.resolve(failures([failure], 1, true));
      if (url.endsWith('page=2&limit=20')) return Promise.resolve(failures([], 2, false));
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    render(<AiPage />);
    await screen.findByText(/note-1/);

    fireEvent.click(screen.getByRole('button', { name: '下一页失败任务' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/ai/failures?page=2&limit=20'));
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    expect(screen.getByText('暂无失败任务')).toBeInTheDocument();
  });

  it('renders success, token, cost, coverage, and unknown semantics per group', async () => {
    const mixedUsage: AiUsage = {
      range: '30d',
      groups: [
        usage.groups[0],
        {
          provider: 'dashscope',
          operation: 'embedding',
          calls: 1,
          succeeded: 1,
          inputTokens: null,
          outputTokens: null,
          knownTokenCalls: 0,
          costKnownCalls: 0,
          estimatedCostMicros: null,
        },
      ],
    };
    vi.spyOn(api, 'adminFetch').mockImplementation((url) => {
      if (url === '/api/admin/auth/me') return Promise.resolve(session('viewer'));
      if (url.startsWith('/api/admin/ai/usage')) return Promise.resolve(mixedUsage);
      return Promise.resolve(failures([]));
    });
    render(<AiPage />);

    const knownRow = await screen.findByRole('row', { name: /deepseek/ });
    expect(within(knownRow).getByText('50%')).toBeInTheDocument();
    expect(within(knownRow).getByText('30')).toBeInTheDocument();
    expect(within(knownRow).getAllByText('100%')).toHaveLength(2);
    expect(within(knownRow).getByText('¥2.00')).toBeInTheDocument();

    const unknownRow = screen.getByRole('row', { name: /dashscope/ });
    expect(within(unknownRow).getAllByText('数据积累中').length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['owner', true],
    ['operator', true],
    ['support', false],
    ['viewer', false],
  ] as const)('shows retry controls for %s according to role', async (role, allowed) => {
    mockPage(role);
    render(<AiPage />);
    await screen.findByText(/note-1/);

    if (allowed) expect(screen.getByRole('button', { name: '安全重试' })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: '安全重试' })).not.toBeInTheDocument();
  });

  it('posts canonical retry input, shows pending, refetches failures, and exposes the result', async () => {
    const fetch = mockPage('operator');
    let resolveRetry!: (value: unknown) => void;
    const post = vi.spyOn(api, 'adminPost').mockImplementation(
      () => new Promise((resolve) => { resolveRetry = resolve; }),
    );
    render(<AiPage />);
    fireEvent.click(await screen.findByRole('button', { name: '安全重试' }));
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '重新生成缺失向量' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(post).toHaveBeenCalledWith('/api/admin/ai/failures/note-1/retry', {
      artifact: 'embedding',
      expectedRevision: 4,
      reason: '重新生成缺失向量',
    });
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/ai/failures'))).toHaveLength(1);

    resolveRetry({ retryStatus: 'saved' });
    expect(await screen.findByRole('status')).toHaveTextContent('重试结果：saved');
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/ai/failures'))).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('retains retry errors in the dialog without refetching failures', async () => {
    const fetch = mockPage('owner');
    vi.spyOn(api, 'adminPost').mockRejectedValue(new Error('revision 已变化'));
    render(<AiPage />);
    fireEvent.click(await screen.findByRole('button', { name: '安全重试' }));
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '重新生成缺失向量' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('revision 已变化');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/ai/failures'))).toHaveLength(1);
  });
});

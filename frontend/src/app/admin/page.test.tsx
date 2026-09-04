import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from './lib/adminApi';
import type { Overview } from './lib/contracts';
import AdminOverviewPage from './page';

const completeOverview: Overview = {
  summary: {
    totalUsers: 12,
    todayNewUsers: 2,
    dau: 3,
    wau: 8,
    mau: 10,
    activationUsers: 5,
    totalNotes: 24,
    totalChats: 7,
    totalAiCalls: 20,
    aiSuccessRate: 0.75,
    failedArtifacts: 1,
  },
  timeseries: [{ day: '2026-09-01', value: 4 }],
  retention: { d1: 0.5, d7: null, d30: null },
  tokenCoverage: {
    knownCalls: 15,
    totalSucceededCalls: 18,
    inputTokens: 100,
    outputTokens: 50,
    rate: 15 / 18,
  },
  costCoverage: {
    knownCalls: 10,
    totalCalls: 18,
    estimatedCostMicros: 1230000,
    currency: 'CNY',
    rate: 10 / 18,
  },
};

describe('AdminOverviewPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the loading state visible until overview data arrives', async () => {
    let resolveOverview!: (value: Overview) => void;
    vi.spyOn(api, 'adminFetch').mockImplementation(
      () => new Promise((resolve) => { resolveOverview = resolve as typeof resolveOverview; }),
    );
    render(<AdminOverviewPage />);

    expect(screen.getByText('加载概览中…')).toBeInTheDocument();
    resolveOverview(completeOverview);
    expect(await screen.findByText('总用户')).toBeInTheDocument();
  });

  it('renders all required metrics, coverage semantics, retention unknowns, and an accessible trend', async () => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue(completeOverview);
    render(<AdminOverviewPage />);

    await screen.findByText('总用户');
    for (const label of [
      '今日新增', 'DAU', 'WAU', 'MAU', '激活用户', '笔记', '聊天会话',
      'AI 调用', 'AI 成功率', '失败富化', 'Token', '估算成本',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('¥1.23')).toBeInTheDocument();
    expect(screen.getByText(/Token 覆盖：83%/)).toBeInTheDocument();
    expect(screen.getByText(/D7：数据积累中/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '最近趋势' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 天' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches from 7d to 30d and marks the selected range', async () => {
    const fetch = vi.spyOn(api, 'adminFetch').mockResolvedValue(completeOverview);
    render(<AdminOverviewPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/overview?range=7d'));

    fireEvent.click(screen.getByRole('button', { name: '30 天' }));

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/admin/overview?range=30d'));
    expect(screen.getByRole('button', { name: '30 天' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 天' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('retries the same selected range and recovers visibly after an error', async () => {
    const fetch = vi.spyOn(api, 'adminFetch')
      .mockRejectedValueOnce(new Error('概览暂不可用'))
      .mockResolvedValueOnce(completeOverview);
    render(<AdminOverviewPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('概览暂不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新加载概览' }));

    expect(await screen.findByText('总用户')).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/overview?range=7d');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an explicit empty state for a range with no accumulated activity', async () => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue({
      ...completeOverview,
      summary: Object.fromEntries(Object.keys(completeOverview.summary).map((key) => [key, 0])),
      timeseries: [{ day: '2026-09-01', value: 0 }],
      retention: { d1: null, d7: null, d30: null },
      tokenCoverage: { inputTokens: 0, outputTokens: 0, rate: null },
      costCoverage: { estimatedCostMicros: null, rate: null },
    });
    render(<AdminOverviewPage />);

    expect(await screen.findByRole('status', { name: '概览空状态' })).toHaveTextContent('当前范围暂无运营数据');
  });
});

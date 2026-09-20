import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      '今日新增用户', '今日活跃', '近 7 天活跃', '近 30 天活跃', '累计激活用户',
      '笔记总量', '累计聊天会话', 'AI 调用', 'AI 成功率', 'AI 处理失败', '已知 Token 用量', '估算成本',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('¥1.23')).toBeInTheDocument();
    expect(screen.getByText(/Token 覆盖：83%/)).toBeInTheDocument();
    expect(screen.getByText('D7').closest('div')).toHaveTextContent('数据积累中');
    expect(screen.getByRole('img', { name: '每日新增笔记趋势' })).toBeInTheDocument();
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

  it('keeps the latest range result when an older request finishes last', async () => {
    let resolveThirtyDays!: (value: Overview) => void;
    let resolveSevenDays!: (value: Overview) => void;
    vi.spyOn(api, 'adminFetch')
      .mockResolvedValueOnce(completeOverview)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveThirtyDays = resolve as typeof resolveThirtyDays;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSevenDays = resolve as typeof resolveSevenDays;
      }));
    render(<AdminOverviewPage />);
    await screen.findByText('总用户');

    fireEvent.click(screen.getByRole('button', { name: '30 天' }));
    fireEvent.click(screen.getByRole('button', { name: '7 天' }));
    await act(async () => resolveSevenDays({
      ...completeOverview,
      summary: { ...completeOverview.summary, totalUsers: 713 },
    }));
    expect(screen.getByText('713')).toBeInTheDocument();
    await act(async () => resolveThirtyDays({
      ...completeOverview,
      summary: { ...completeOverview.summary, totalUsers: 301 },
    }));

    expect(screen.getByText('713')).toBeInTheDocument();
    expect(screen.queryByText('301')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 天' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the successful range labeled correctly if the next range fails', async () => {
    vi.spyOn(api, 'adminFetch')
      .mockResolvedValueOnce(completeOverview)
      .mockRejectedValueOnce(new Error('概览暂不可用'));
    render(<AdminOverviewPage />);
    await screen.findByText('总用户');

    fireEvent.click(screen.getByRole('button', { name: '30 天' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('当前保留上次加载的近 7 天数据');
    expect(screen.getByText('近 7 天 · 按上海时间统计')).toBeInTheDocument();
    expect(screen.queryByText('近 30 天 · 按上海时间统计')).not.toBeInTheDocument();
  });

  it('does not present missing AI usage and pricing as measured zeroes', async () => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue({
      ...completeOverview,
      summary: { ...completeOverview.summary, totalAiCalls: 0, aiSuccessRate: null, failedArtifacts: 0 },
      tokenCoverage: { ...completeOverview.tokenCoverage, knownCalls: 0, totalSucceededCalls: 0, inputTokens: 0, outputTokens: 0, rate: null },
      costCoverage: { ...completeOverview.costCoverage, knownCalls: 0, totalCalls: 0, estimatedCostMicros: null, rate: null },
    });
    render(<AdminOverviewPage />);

    await screen.findByText('总用户');
    expect(screen.getByText('暂无已知用量')).toBeInTheDocument();
    expect(screen.getByText('暂不可估算')).toBeInTheDocument();
    expect(screen.queryByText('调用全部成功')).not.toBeInTheDocument();
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
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

    expect(await screen.findByRole('status', { name: '概览空状态' })).toHaveTextContent('当前暂无运营数据');
  });
});

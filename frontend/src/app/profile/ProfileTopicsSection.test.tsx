import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileTopicsSection from './ProfileTopicsSection';
import { getProfileTopics, retryFailedProfileTopics } from '../../services/profileTopicsService';

vi.mock('../../services/profileTopicsService', () => ({
  getProfileTopics: vi.fn(),
  retryFailedProfileTopics: vi.fn(),
}));

const getTopics = vi.mocked(getProfileTopics);
const retryTopics = vi.mocked(retryFailedProfileTopics);

function dto(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'all' as const,
    timezone: 'Asia/Shanghai' as const,
    rangeStart: null,
    rangeEnd: null,
    totalNotesInRange: 3,
    readyNotesInRange: 2,
    pendingNotesInRange: 0,
    failedNotesInRange: 1,
    lastErrorAt: '2026-10-02T01:00:00.000Z',
    topics: [{ topic: '人工智能', noteCount: 2 }],
    staleSnapshot: null,
    indexStatus: 'partial' as const,
    updatedAt: '2026-10-02T01:00:00.000Z',
    ...overrides,
  };
}

describe('ProfileTopicsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTopics.mockResolvedValue(dto());
    retryTopics.mockResolvedValue({ acceptedCount: 1, alreadyRunningCount: 0, rateLimitedCount: 0, nextRetryAt: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('默认范围为全部笔记', async () => {
    render(<ProfileTopicsSection />);
    expect(await screen.findByRole('tab', { name: '全部笔记' })).toHaveAttribute('aria-selected', 'true');
    expect(getTopics).toHaveBeenCalledWith('all', expect.anything());
  });

  it('切换范围时不调用重试或 AI', async () => {
    render(<ProfileTopicsSection />);
    await screen.findByText('人工智能');
    fireEvent.click(screen.getByRole('tab', { name: '近一年' }));
    await waitFor(() => expect(getTopics).toHaveBeenCalledWith('year', expect.anything()));
    expect(retryTopics).not.toHaveBeenCalled();
  });

  it('显示 X/Y 和当前 ready 话题', async () => {
    render(<ProfileTopicsSection />);
    expect(await screen.findByText('已整理 2 / 3 篇笔记')).toBeInTheDocument();
    expect(screen.getByText('人工智能')).toBeInTheDocument();
    expect(screen.queryByText(/兴趣占比|话题占比|\d+%/)).not.toBeInTheDocument();
  });

  it('单独显示旧快照标签', async () => {
    getTopics.mockResolvedValue(dto({ staleSnapshot: { noteCount: 1, indexedAt: '2026-09-30T00:00:00.000Z', topics: [{ topic: '旧话题', noteCount: 1 }], label: '旧快照，不计入当前覆盖' } }));
    render(<ProfileTopicsSection />);
    expect(await screen.findByText(/旧快照，不计入当前覆盖/)).toBeInTheDocument();
    expect(screen.getByText('旧话题')).toBeInTheDocument();
    expect(screen.getByText('已整理 2 / 3 篇笔记')).toBeInTheDocument();
    expect(screen.getByText(/1 篇笔记 · 最近整理/)).toBeInTheDocument();
  });

  it('无结果范围提供返回全部笔记的入口', async () => {
    getTopics.mockImplementation(async (scope) => scope === 'all' ? dto() : dto({ scope, totalNotesInRange: 0, readyNotesInRange: 0, pendingNotesInRange: 0, failedNotesInRange: 0, topics: [], indexStatus: 'empty' }));
    render(<ProfileTopicsSection />);
    fireEvent.click(screen.getByRole('tab', { name: '近六个月' }));
    expect(await screen.findByRole('button', { name: '查看全部笔记' })).toBeInTheDocument();
  });

  it('保留缓存话题并标注部分失败', async () => {
    render(<ProfileTopicsSection />);
    expect(await screen.findByText('人工智能')).toBeInTheDocument();
    expect(screen.getByText(/1 篇笔记整理失败/)).toBeInTheDocument();
    expect(screen.getByText(/最近失败/)).toBeInTheDocument();
  });

  it('只重试失败笔记', async () => {
    render(<ProfileTopicsSection />);
    fireEvent.click(await screen.findByRole('button', { name: '重试失败笔记' }));
    await waitFor(() => expect(retryTopics).toHaveBeenCalledWith('all'));
    expect(getTopics).toHaveBeenCalledWith('all', expect.anything());
  });

  it('为受限流笔记显示下次重试时间', async () => {
    retryTopics.mockResolvedValue({ acceptedCount: 0, alreadyRunningCount: 0, rateLimitedCount: 1, nextRetryAt: new Date(Date.now() + 60_000).toISOString() });
    render(<ProfileTopicsSection />);
    fireEvent.click(await screen.findByRole('button', { name: '重试失败笔记' }));
    expect(await screen.findByText(/下次可重试/)).toBeInTheDocument();
  });

  it('无需编辑笔记即可在冷却后重试', async () => {
    vi.useFakeTimers();
    retryTopics.mockResolvedValue({ acceptedCount: 0, alreadyRunningCount: 0, rateLimitedCount: 1, nextRetryAt: new Date(Date.now() + 5000).toISOString() });
    render(<ProfileTopicsSection />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '重试失败笔记' }));
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByRole('button', { name: '重试失败笔记' })).toBeEnabled();
  });

  it('无缓存时显示本区域错误', async () => {
    getTopics.mockRejectedValue(new Error('private server detail'));
    render(<ProfileTopicsSection />);
    expect(await screen.findByText('话题加载失败，请重试。')).toBeInTheDocument();
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
  });

  it('结束加载并显示独立错误与重试入口', async () => {
    getTopics.mockRejectedValueOnce(new Error('failure')).mockResolvedValueOnce(dto());
    render(<ProfileTopicsSection />);
    fireEvent.click(await screen.findByRole('button', { name: '重试话题加载' }));
    expect(await screen.findByText('人工智能')).toBeInTheDocument();
    expect(getTopics).toHaveBeenCalledTimes(2);
  });

  it('刷新失败时保留本范围成功缓存', async () => {
    render(<ProfileTopicsSection />);
    expect(await screen.findByText('人工智能')).toBeInTheDocument();
    getTopics.mockRejectedValueOnce(new Error('refresh failed'));
    fireEvent.click(screen.getByRole('button', { name: '刷新话题' }));
    expect(await screen.findByText(/刷新失败，已保留上次成功数据/)).toBeInTheDocument();
    expect(screen.getByText('人工智能')).toBeInTheDocument();
  });

  it('旧范围响应不能覆盖新范围', async () => {
    let resolveOld!: (value: ReturnType<typeof dto>) => void;
    getTopics.mockImplementation((scope) => scope === 'all' ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(dto({ scope, topics: [{ topic: '近年话题', noteCount: 1 }] })));
    render(<ProfileTopicsSection />);
    fireEvent.click(screen.getByRole('tab', { name: '近一年' }));
    expect(await screen.findByText('近年话题')).toBeInTheDocument();
    await act(async () => resolveOld(dto({ topics: [{ topic: '旧范围话题', noteCount: 1 }] })));
    expect(screen.getByText('近年话题')).toBeInTheDocument();
    expect(screen.queryByText('旧范围话题')).not.toBeInTheDocument();
  });

  it('后台整理轮询有界且只使用 GET', async () => {
    vi.useFakeTimers();
    getTopics.mockImplementation(async () => dto({ indexStatus: 'building', readyNotesInRange: 0, pendingNotesInRange: 3, failedNotesInRange: 0, topics: [] }));
    render(<ProfileTopicsSection />);
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); await Promise.resolve(); });
    }
    expect(getTopics.mock.calls.length).toBeLessThanOrEqual(7);
    expect(retryTopics).not.toHaveBeenCalled();
    expect(screen.getByText(/仍在后台处理/)).toBeInTheDocument();
  });

  it('离开话题面板后清理后台轮询', async () => {
    vi.useFakeTimers();
    getTopics.mockImplementation(async () => dto({ indexStatus: 'building', readyNotesInRange: 0, pendingNotesInRange: 3, failedNotesInRange: 0, topics: [] }));
    const { unmount } = render(<ProfileTopicsSection />);
    await act(async () => { await Promise.resolve(); });
    expect(getTopics).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(getTopics).toHaveBeenCalledTimes(1);
  });

  it('部分限流时不禁用其他失败笔记的重试', async () => {
    retryTopics.mockResolvedValue({ acceptedCount: 1, alreadyRunningCount: 0, rateLimitedCount: 2, nextRetryAt: new Date(Date.now() + 60_000).toISOString() });
    render(<ProfileTopicsSection />);
    const button = await screen.findByRole('button', { name: '重试失败笔记' });
    fireEvent.click(button);
    await waitFor(() => expect(retryTopics).toHaveBeenCalledTimes(1));
    expect(button).toBeEnabled();
  });

  it('当前范围整理完成后停止轮询', async () => {
    vi.useFakeTimers();
    getTopics.mockImplementationOnce(async () => dto({ indexStatus: 'building', readyNotesInRange: 0, pendingNotesInRange: 3, failedNotesInRange: 0, topics: [] }))
      .mockImplementation(async () => dto({ indexStatus: 'ready', pendingNotesInRange: 0, failedNotesInRange: 0 }));
    render(<ProfileTopicsSection />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(getTopics).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(getTopics).toHaveBeenCalledTimes(2);
  });

  it('重复点击时不会并发提交人工重试', async () => {
    let resolveRetry!: (value: { acceptedCount: number; alreadyRunningCount: number; rateLimitedCount: number; nextRetryAt: null }) => void;
    retryTopics.mockReturnValue(new Promise((resolve) => { resolveRetry = resolve; }));
    render(<ProfileTopicsSection />);
    const button = await screen.findByRole('button', { name: '重试失败笔记' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(retryTopics).toHaveBeenCalledTimes(1);
    await act(async () => resolveRetry({ acceptedCount: 1, alreadyRunningCount: 0, rateLimitedCount: 0, nextRetryAt: null }));
  });

  it('重试返回时若已切换范围，反馈和冷却只属于发起范围', async () => {
    let resolveRetry!: (value: { acceptedCount: number; alreadyRunningCount: number; rateLimitedCount: number; nextRetryAt: string }) => void;
    retryTopics.mockReturnValue(new Promise((resolve) => { resolveRetry = resolve; }));
    getTopics.mockImplementation(async (scope) => dto({ scope, failedNotesInRange: 1 }));
    render(<ProfileTopicsSection />);
    fireEvent.click(await screen.findByRole('button', { name: '重试失败笔记' }));
    fireEvent.click(screen.getByRole('tab', { name: '近一年' }));
    expect(screen.getByRole('tab', { name: '近一年' })).toHaveAttribute('aria-selected', 'true');
    await act(async () => resolveRetry({ acceptedCount: 0, alreadyRunningCount: 0, rateLimitedCount: 1, nextRetryAt: new Date(Date.now() + 60_000).toISOString() }));
    const yearRetryButton = await screen.findByRole('button', { name: '重试失败笔记' });
    expect(yearRetryButton).toBeEnabled();
    expect(screen.queryByText(/下次可重试/)).not.toBeInTheDocument();
    expect(screen.queryByText(/暂受冷却限制/)).not.toBeInTheDocument();
  });

  it('卸载后完成的人工重试不会再发起话题 GET', async () => {
    let resolveRetry!: (value: { acceptedCount: number; alreadyRunningCount: number; rateLimitedCount: number; nextRetryAt: null }) => void;
    retryTopics.mockReturnValue(new Promise((resolve) => { resolveRetry = resolve; }));
    const { unmount } = render(<ProfileTopicsSection />);
    fireEvent.click(await screen.findByRole('button', { name: '重试失败笔记' }));
    expect(getTopics).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => resolveRetry({ acceptedCount: 1, alreadyRunningCount: 0, rateLimitedCount: 0, nextRetryAt: null }));
    expect(getTopics).toHaveBeenCalledTimes(1);
  });
});

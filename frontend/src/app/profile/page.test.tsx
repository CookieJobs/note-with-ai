import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './page';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  router: { push: vi.fn() },
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
  getProfileAnalysis: vi.fn(),
  triggerProfileAnalysis: vi.fn(),
  getStats: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('../../utils/auth', () => ({ isAuthenticated: mocks.isAuthenticated, getUser: mocks.getUser }));
vi.mock('../../services/profileService', () => ({
  getProfileAnalysis: mocks.getProfileAnalysis,
  triggerProfileAnalysis: mocks.triggerProfileAnalysis,
  getStats: mocks.getStats,
}));
vi.mock('../../services/userService', () => ({ updateProfile: mocks.updateProfile, changePassword: mocks.changePassword }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div data-testid="top-navigation" /> }));
vi.mock('sonner', () => ({ toast: { info: mocks.toastInfo, success: mocks.toastSuccess, error: mocks.toastError } }));

const profile = {
  interests: [{ topic: '写作', score: 0.8 }],
  summary: '持续记录与复盘',
  expertise: [{ area: '写作', level: '熟练' }],
  theme: { themeName: '纸感', cssType: 'gradient', cssValue: 'linear-gradient(#fff, #eee)', reasoning: '柔和配色' },
};

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    userProfile: null,
    historicalProfile: null,
    profileStatus: 'idle',
    noteCount: 5,
    analysisError: '',
    lastAnalyzedAt: null,
    analysisInputNoteCount: null,
    analysisInputScope: null,
    ...overrides,
  };
}

function stats(overrides: Record<string, unknown> = {}) {
  return { totalNotes: 5, notesThisMonth: 2, ...overrides };
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.router.push = mocks.push;
    mocks.isAuthenticated.mockReturnValue(true);
    mocks.getUser.mockReturnValue({ id: 'user-1', username: '测试用户', email: 'test@example.com', createdAt: '2026-01-01T00:00:00.000Z' });
    mocks.getProfileAnalysis.mockResolvedValue(analysis());
    mocks.getStats.mockResolvedValue(stats());
    mocks.triggerProfileAnalysis.mockResolvedValue({ accepted: true, profileStatus: 'analyzing', reason: 'accepted', analysisError: '' });
    mocks.updateProfile.mockResolvedValue({ username: '更新用户' });
    mocks.changePassword.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('不请求或渲染每日推荐', async () => {
    render(<ProfilePage />);
    await screen.findByText('使用统计');
    expect(screen.queryByText(/每日推荐/)).not.toBeInTheDocument();
    expect(screen.queryByText(/For You/)).not.toBeInTheDocument();
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
  });

  it('分别加载统计和个人资料', async () => {
    let resolveProfile!: (value: ReturnType<typeof analysis>) => void;
    let resolveStats!: (value: ReturnType<typeof stats>) => void;
    mocks.getProfileAnalysis.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
    mocks.getStats.mockReturnValue(new Promise((resolve) => { resolveStats = resolve; }));
    render(<ProfilePage />);
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
    await act(async () => resolveStats(stats()));
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('正在加载画像…')).toBeInTheDocument();
    await act(async () => resolveProfile(analysis({ userProfile: profile, profileStatus: 'ready' })));
    expect(await screen.findByText('持续记录与复盘')).toBeInTheDocument();
  });

  it('统计失败后结束骨架屏且仅重试统计', async () => {
    mocks.getStats.mockRejectedValueOnce(new Error('internal stats error')).mockResolvedValueOnce(stats());
    render(<ProfilePage />);
    expect(await screen.findByText('统计暂不可用')).toBeInTheDocument();
    expect(screen.queryByText('正在加载画像…')).not.toBeInTheDocument();
    expect(screen.getByText(/还没有画像数据/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试统计' }));
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(mocks.getStats).toHaveBeenCalledTimes(2);
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
  });

  it('笔记达到五篇或以上且缺少画像时显示生成操作', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ noteCount: 5 }));
    render(<ProfilePage />);
    const generate = await screen.findByRole('button', { name: '生成画像' });
    fireEvent.click(generate);
    await waitFor(() => expect(mocks.triggerProfileAnalysis).toHaveBeenCalledTimes(1));
    expect(mocks.triggerProfileAnalysis).toHaveBeenCalledWith();
  });

  it('笔记少于五篇时显示数据不足说明', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ noteCount: 3, profileStatus: 'insufficient_data' }));
    render(<ProfilePage />);
    expect(await screen.findByText((_, node) => node?.tagName === 'P' && node.textContent?.includes('还需要 2 篇') === true)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成画像|重新分析/ })).not.toBeInTheDocument();
  });

  it('笔记数低于五篇时仅将缓存推断显示为历史数据', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ noteCount: 4, profileStatus: 'insufficient_data', historicalProfile: profile }));
    render(<ProfilePage />);
    expect(await screen.findByText('历史画像快照')).toBeInTheDocument();
    expect(screen.getByText('持续记录与复盘')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === 'P' && node.textContent?.includes('当前有 4 篇笔记') === true)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成画像|重新分析/ })).not.toBeInTheDocument();
  });

  it('笔记恢复到五篇后仍将未重新分析的画像显示为历史数据', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ noteCount: 5, profileStatus: 'idle', historicalProfile: profile }));
    render(<ProfilePage />);
    expect(await screen.findByText('历史画像快照')).toBeInTheDocument();
    expect(screen.getByText(/尚未基于当前笔记重新分析/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument();
    expect(screen.queryByText('还没有画像数据，可以在笔记达到 5 篇后生成。')).not.toBeInTheDocument();
  });

  it('分析失败后保留缓存的旧画像并提供重试', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ userProfile: profile, profileStatus: 'failed', analysisError: '内部异常' }));
    render(<ProfilePage />);
    expect(await screen.findByText('持续记录与复盘')).toBeInTheDocument();
    expect(screen.getByText('画像分析暂未完成，请稍后重试。')).toBeInTheDocument();
    expect(screen.queryByText('内部异常')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument();
  });

  it('编辑资料弹窗仍可保存用户名并保留只读邮箱', async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    const email = screen.getByDisplayValue('test@example.com');
    expect(email).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('设置用户名'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ username: '新名字' })));
  });

  it('修改密码弹窗仍可打开并提交有效凭据', async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: '修改密码' }));
    fireEvent.change(screen.getByPlaceholderText('输入当前密码'), { target: { value: 'current123' } });
    fireEvent.change(screen.getByPlaceholderText('至少8位，包含字母和数字'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByPlaceholderText('再次输入新密码'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith({ oldPassword: 'current123', newPassword: 'newpass123' }));
  });
});

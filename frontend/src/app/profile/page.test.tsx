import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './page';
import Providers from '../providers';
import WorkspaceRoot from '../../components/workspace/WorkspaceRoot';
import { WorkspaceContext, type WorkspaceContextValue } from '../../components/workspace/WorkspaceContext';

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

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router, usePathname: () => '/profile' }));
vi.mock('../../utils/auth', () => ({ isAuthenticated: mocks.isAuthenticated, getUser: mocks.getUser, getToken: () => 'profile-test-token', logout: vi.fn(), authFetch: async () => ({ ok: true, json: async () => ({ success: true, data: { notes: [] } }) }) }));
vi.mock('../../services/profileService', () => ({
  getProfileAnalysis: mocks.getProfileAnalysis,
  triggerProfileAnalysis: mocks.triggerProfileAnalysis,
  getStats: mocks.getStats,
}));
vi.mock('../../services/userService', () => ({ updateProfile: mocks.updateProfile, changePassword: mocks.changePassword }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div data-testid="top-navigation" /> }));
vi.mock('../../services/inspirationService', () => ({ getUnviewedInspirationCount: async () => 0 }));
vi.mock('../../hooks/useInspirationSettings', () => ({ useInspirationSettings: () => ({ settings: null, loading: false, saving: false, error: null, refetch: vi.fn(), setEnabled: vi.fn() }) }));
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
    analysisFailedAt: null,
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
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    mocks.router.push = mocks.push;
    mocks.isAuthenticated.mockReturnValue(true);
    mocks.getUser.mockReturnValue({ id: 'user-1', username: '测试用户', email: 'test@example.com', createdAt: '2026-01-01T00:00:00.000Z' });
    mocks.getProfileAnalysis.mockResolvedValue(analysis());
    mocks.getStats.mockResolvedValue(stats());
    mocks.triggerProfileAnalysis.mockResolvedValue({ accepted: true, profileStatus: 'analyzing', reason: 'accepted', analysisError: '' });
    mocks.updateProfile.mockResolvedValue({ username: '更新用户' });
    mocks.changePassword.mockResolvedValue(undefined);
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('真实 Provider/WorkspaceRoot 下未登录个人页仍引导认证 (final F3)', async () => {
    mocks.isAuthenticated.mockReturnValue(false);
    mocks.getUser.mockReturnValue(null);
    render(<Providers><WorkspaceRoot><ProfilePage /></WorkspaceRoot></Providers>);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/auth'));
    expect(mocks.getProfileAnalysis).not.toHaveBeenCalled();
    expect(mocks.getStats).not.toHaveBeenCalled();
  });

  it('真实 Provider/WorkspaceRoot 初始化共享身份时不误跳，随后显示有效账户 (final F3)', async () => {
    render(<Providers><WorkspaceRoot><ProfilePage /></WorkspaceRoot></Providers>);
    expect(await screen.findByRole('heading', { name: '测试用户', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('使用统计')).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
  });

  it('不请求或渲染每日推荐', async () => {
    render(<ProfilePage />);
    await screen.findByText('使用统计');
    expect(screen.queryByText(/每日推荐/)).not.toBeInTheDocument();
    expect(screen.queryByText(/For You/)).not.toBeInTheDocument();
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
  });

  it('个人中心不再渲染话题面板，统计和画像继续加载', async () => {
    render(<ProfilePage />);
    await screen.findByText('使用统计');
    expect(screen.queryByRole('heading', { name: '笔记话题' })).not.toBeInTheDocument();
  });

  it.each([
    { userProfile: profile, profileStatus: 'ready' },
    { userProfile: { ...profile, theme: undefined }, profileStatus: 'ready' },
    { historicalProfile: profile, noteCount: 4, profileStatus: 'insufficient_data' },
  ])('忽略画像中的旧配色数据并继续展示画像内容：%j', async (result) => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis(result));
    const { container } = render(<ProfilePage />);

    expect(await screen.findByText('持续记录与复盘')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '技能领域' })).toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveAttribute('style');
    expect(screen.queryByText(/专属氛围色/)).not.toBeInTheDocument();
    expect(screen.queryByText('柔和配色')).not.toBeInTheDocument();
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
    expect(mocks.triggerProfileAnalysis).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('已有当前画像时仍可手动重新分析', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ userProfile: profile, profileStatus: 'ready' }));
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: '重新分析' }));
    await waitFor(() => expect(mocks.triggerProfileAnalysis).toHaveBeenCalledTimes(1));
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
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

  it('历史画像缺少范围元数据时明确标记为范围未知', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ noteCount: 5, profileStatus: 'idle', historicalProfile: profile, analysisInputScope: null, analysisInputNoteCount: null, lastAnalyzedAt: null }));
    render(<ProfilePage />);
    expect(await screen.findByText('历史画像快照')).toBeInTheDocument();
    expect(screen.getByText('范围未知的旧画像')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument();
  });

  it('画像 GET 首次失败时只显示本区重试，重试仍只发 GET', async () => {
    mocks.getProfileAnalysis.mockRejectedValueOnce(new Error('internal profile error')).mockResolvedValueOnce(analysis({ userProfile: profile, profileStatus: 'ready' }));
    render(<ProfilePage />);
    expect(await screen.findByText('画像加载失败，请重试。')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试画像' }));
    expect(await screen.findByText('持续记录与复盘')).toBeInTheDocument();
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(2);
    expect(mocks.triggerProfileAnalysis).not.toHaveBeenCalled();
    expect(mocks.getStats).toHaveBeenCalledTimes(1);
  });

  it('画像轮询等待上一请求完成后再查询', async () => {
    vi.useFakeTimers();
    let resolvePending!: (value: ReturnType<typeof analysis>) => void;
    mocks.getProfileAnalysis
      .mockResolvedValueOnce(analysis({ profileStatus: 'analyzing', userProfile: profile }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }))
      .mockResolvedValueOnce(analysis({ profileStatus: 'ready', userProfile: profile }));
    render(<ProfilePage />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(2);
    expect(screen.getByText('持续记录与复盘')).toBeInTheDocument();
    await act(async () => { resolvePending(analysis({ profileStatus: 'ready', userProfile: profile })); await Promise.resolve(); });
    expect(screen.getByText('持续记录与复盘')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(2);
  });

  it('离开页面时清理画像轮询定时器', async () => {
    vi.useFakeTimers();
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ profileStatus: 'analyzing' }));
    const { unmount } = render(<ProfilePage />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(1);
  });

  it('遗留analyzing状态轮询最多15次后提供检查和恢复入口', async () => {
    vi.useFakeTimers();
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ userProfile: profile, profileStatus: 'analyzing' }));
    render(<ProfilePage />);
    await act(async () => { await Promise.resolve(); });
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(16);
    expect(screen.getByText('画像仍未完成，可检查进度或恢复分析。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查进度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复分析' })).toBeInTheDocument();
  });

  it('正在进行的画像GET未结束时不会叠加下一次轮询', async () => {
    vi.useFakeTimers();
    let resolvePending!: (value: ReturnType<typeof analysis>) => void;
    mocks.getProfileAnalysis.mockResolvedValueOnce(analysis({ profileStatus: 'analyzing' }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));
    render(<ProfilePage />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(2);
    await act(async () => resolvePending(analysis({ profileStatus: 'ready', userProfile: profile })));
  });

  it('遗留任务轮询GET失败后停止继续轮询', async () => {
    vi.useFakeTimers();
    mocks.getProfileAnalysis.mockResolvedValueOnce(analysis({ profileStatus: 'analyzing' }))
      .mockRejectedValueOnce(new Error('network down'));
    render(<ProfilePage />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.getProfileAnalysis).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/画像刷新失败/)).toBeInTheDocument();
  });

  it('达到轮询上限后恢复操作显式发起分析POST', async () => {
    vi.useFakeTimers();
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ userProfile: profile, profileStatus: 'analyzing' }));
    render(<ProfilePage />);
    await act(async () => { await Promise.resolve(); });
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '恢复分析' }));
      await Promise.resolve();
    });
    expect(mocks.triggerProfileAnalysis).toHaveBeenCalledTimes(1);
  });

  it('失败画像只显示真实失败时间，旧记录没有时间时不推算', async () => {
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ profileStatus: 'failed', analysisFailedAt: '2026-10-01T01:00:00.000Z' }));
    const { unmount } = render(<ProfilePage />);
    expect(await screen.findByText(/最近失败/)).toBeInTheDocument();
    expect(screen.getByText(/2026年10月1日 09:00/)).toBeInTheDocument();
    unmount();
    mocks.getProfileAnalysis.mockResolvedValue(analysis({ profileStatus: 'failed', analysisFailedAt: null }));
    render(<ProfilePage />);
    expect(await screen.findByText('画像分析暂未完成，请稍后重试。')).toBeInTheDocument();
    expect(screen.queryByText(/最近失败/)).not.toBeInTheDocument();
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

  it('仅保存用户名时省略 avatar 并保留旧 URL', async () => {
    const legacyUrl = 'https://legacy.example/avatar.png';
    mocks.getUser.mockReturnValue({ id: 'user-1', username: '测试用户', email: 'test@example.com', avatar: legacyUrl });
    mocks.updateProfile.mockResolvedValue({ username: '新名字', avatar: legacyUrl });

    const { container } = render(<ProfilePage />);
    await waitFor(() => expect(container.querySelector('section[aria-labelledby="account-title"] img')).toHaveAttribute('src', legacyUrl));
    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    fireEvent.change(screen.getByPlaceholderText('设置用户名'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ username: '新名字' }));
    expect(container.querySelector('section[aria-labelledby="account-title"] img')).toHaveAttribute('src', legacyUrl);
  });

  it('无存储头像时默认选择首字母且用户名保存省略 avatar', async () => {
    mocks.updateProfile.mockResolvedValue({ username: '新名字' });
    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    expect(screen.getByRole('radio', { name: '姓名首字母' })).toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('设置用户名'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ username: '新名字' }));
  });

  it('保留未知旧头像值且不在用户名保存时迁移', async () => {
    const unknownLegacyValue = 'legacy:unrecognized-avatar';
    mocks.getUser.mockReturnValue({ id: 'user-1', username: '测试用户', email: 'test@example.com', avatar: unknownLegacyValue });
    mocks.updateProfile.mockResolvedValue({ username: '新名字', avatar: unknownLegacyValue });
    const { container } = render(<ProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByAltText('头像预览：现有头像')).toHaveAttribute('src', unknownLegacyValue);
    fireEvent.change(screen.getByPlaceholderText('设置用户名'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ username: '新名字' }));
    expect(container.querySelector('section[aria-labelledby="account-title"] img')).toHaveAttribute('src', unknownLegacyValue);
  });

  it('明确放弃后才丢弃头像草稿', async () => {
    const legacyUrl = 'https://legacy.example/avatar.png';
    mocks.getUser.mockReturnValue({ id: 'user-1', username: '测试用户', email: 'test@example.com', avatar: legacyUrl });
    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 3' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByText('放弃未保存的修改？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByAltText('头像预览：现有头像')).toHaveAttribute('src', legacyUrl);
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 4' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));

    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('显式保存预设时写入其稳定键', async () => {
    mocks.updateProfile.mockResolvedValue({ username: '测试用户', avatar: 'preset:03' });
    const { container } = render(<ProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 3' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ username: '测试用户', avatar: 'preset:03' }));
    expect(container.querySelector('section[aria-labelledby="account-title"] img')).toHaveAttribute('src', '/avatars/profile-preset-03.svg');
  });

  it('渲染旧头像且不做转换，失效时回退首字母', async () => {
    const legacyUrl = 'https://legacy.example/old.png';
    mocks.getUser.mockReturnValue({ id: 'user-1', username: '测试用户', email: 'test@example.com', avatar: legacyUrl });
    const { container } = render(<ProfilePage />);

    await waitFor(() => expect(container.querySelector('section[aria-labelledby="account-title"] img')).toHaveAttribute('src', legacyUrl));
    const legacyImage = container.querySelector('section[aria-labelledby="account-title"] img')!;
    expect(legacyImage).toHaveAttribute('src', legacyUrl);
    fireEvent.error(legacyImage);
    expect(screen.getByText('测试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    expect(screen.getByAltText('头像预览：现有头像')).toHaveAttribute('src', legacyUrl);
    expect(screen.queryByPlaceholderText(/URL|图片/)).not.toBeInTheDocument();
  });

  it('保存期间禁止关闭弹窗以避免迟到的保存结果覆盖新会话', async () => {
    let resolveSave!: (value: { username: string; avatar?: string }) => void;
    mocks.updateProfile.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 1' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();

    await act(async () => resolveSave({ username: '测试用户', avatar: 'preset:01' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('修改密码弹窗仍可打开并提交有效凭据', async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: '修改密码' }));
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('输入当前密码'), { target: { value: 'current123' } });
    fireEvent.change(screen.getByPlaceholderText('至少8位，包含字母和数字'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByPlaceholderText('再次输入新密码'), { target: { value: 'newpass123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认修改' })); });
    expect(mocks.changePassword).toHaveBeenCalledWith({ oldPassword: 'current123', newPassword: 'newpass123' });
    await act(async () => { vi.advanceTimersByTime(1500); });
  });
  it('密码保存期间禁关闭且连续提交只发送一次', async () => {
    mocks.changePassword.mockReturnValue(new Promise(() => {}));
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: '修改密码' }));
    fireEvent.change(screen.getByPlaceholderText('输入当前密码'), { target: { value: 'current123' } });
    fireEvent.change(screen.getByPlaceholderText('至少8位，包含字母和数字'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByPlaceholderText('再次输入新密码'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '修改中…' }));
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
  });

  it('工作区身份切换清除旧统计与画像，迟到旧响应不串账户', async () => {
    let resolveOld!: (value: ReturnType<typeof analysis>) => void;
    mocks.getProfileAnalysis.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(analysis({ userProfile: { ...profile, summary: '新账户画像' }, profileStatus: 'ready' }));
    mocks.getStats.mockResolvedValueOnce(stats({ totalNotes: 80 })).mockResolvedValueOnce(stats({ totalNotes: 6 }));
    const value: WorkspaceContextValue = { user: mocks.getUser(), navigate: vi.fn(), requestAction: vi.fn(), registerEditor: vi.fn(), setRecentNotes: vi.fn(), openSettings: vi.fn(), openAccountDialog: vi.fn() };
    const { rerender } = render(<WorkspaceContext.Provider value={value}><ProfilePage /></WorkspaceContext.Provider>);
    expect(await screen.findByText('80')).toBeInTheDocument();
    rerender(<WorkspaceContext.Provider value={{ ...value, user: { ...value.user!, id: 'user-2', username: '新账户' } }}><ProfilePage /></WorkspaceContext.Provider>);
    expect(await screen.findByText('新账户画像')).toBeInTheDocument();
    expect(screen.queryByText('80')).not.toBeInTheDocument();
    await act(async () => resolveOld(analysis({ userProfile: profile, profileStatus: 'ready' })));
    expect(screen.queryByText('持续记录与复盘')).not.toBeInTheDocument();
    expect(screen.getByText('新账户画像')).toBeInTheDocument();
  });

  it('工作区个人页通过共享动作打开账户及外观，不重复挂载表单', async () => {
    const value: WorkspaceContextValue = { user: { ...mocks.getUser(), username: '共享身份' }, navigate: vi.fn(), requestAction: vi.fn(), registerEditor: vi.fn(), setRecentNotes: vi.fn(), openSettings: vi.fn(), openAccountDialog: vi.fn() };
    render(<WorkspaceContext.Provider value={value}><ProfilePage /></WorkspaceContext.Provider>);
    expect(await screen.findByRole('heading', { level: 1, name: '共享身份' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    fireEvent.click(screen.getByRole('button', { name: '外观设置' }));
    expect(value.openAccountDialog).toHaveBeenNthCalledWith(1, 'profile');
    expect(value.openAccountDialog).toHaveBeenNthCalledWith(2, 'password');
    expect(value.openSettings).toHaveBeenCalledWith('appearance');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

});

import React from 'react';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './page';
import styles from './profile.module.scss';
import './profileBackgroundTheme.selftest';

const profileStyles = readFileSync('src/app/profile/profile.module.scss', 'utf8');
const semanticTokens = readFileSync('src/styles/_variables.scss', 'utf8');

const hexToken = (block: string, token: string) => {
  const value = block.match(new RegExp(`${token}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`Missing ${token}`);
  return value;
};

const rgb = (hex: string) => [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset + 1, offset + 3), 16));
const contrast = (first: string, second: string) => {
  const luminance = (hex: string) => rgb(hex).reduce((total, channel, index) => {
    const normalized = channel / 255;
    const linear = normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    return total + [0.2126, 0.7152, 0.0722][index] * linear;
  }, 0);
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
};

const tokenBlock = (selector: ':root' | '.dark') => {
  const start = semanticTokens.indexOf(`${selector} {`);
  return semanticTokens.slice(start, semanticTokens.indexOf('\n}', start));
};

const atmosphereDeclarations = [...profileStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, rawSelector, body]) =>
  body.split(';').flatMap((declaration) => {
    const propertyMatch = /^\s*([\w-]+)\s*:\s*(.+)$/.exec(declaration);
    if (!propertyMatch) return [];
    return [...propertyMatch[2].matchAll(/var\(--profile-atmosphere-(accent|soft|glow)\)/g)].map(([, token]) => ({
      selector: rawSelector.trim(), property: propertyMatch[1], token, value: propertyMatch[2].trim(),
    }));
  }),
);

const {
  mockPush,
  mockRouter,
  mockIsAuthenticated,
  mockGetUser,
  mockGetFeed,
  mockGetStats,
  mockTriggerAnalysis,
  mockUpdateProfile,
  mockChangePassword,
  mockToastInfo,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRouter: { push: vi.fn() },
  mockIsAuthenticated: vi.fn(),
  mockGetUser: vi.fn(),
  mockGetFeed: vi.fn(),
  mockGetStats: vi.fn(),
  mockTriggerAnalysis: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockChangePassword: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

const realSetTimeout = globalThis.setTimeout;

vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
vi.mock('../../utils/auth', () => ({ isAuthenticated: mockIsAuthenticated, getUser: mockGetUser }));
vi.mock('../../services/feedService', () => ({
  getFeed: mockGetFeed,
  getStats: mockGetStats,
  triggerAnalysis: mockTriggerAnalysis,
}));
vi.mock('../../services/userService', () => ({ updateProfile: mockUpdateProfile, changePassword: mockChangePassword }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div data-testid="top-navigation" /> }));
vi.mock('sonner', () => ({ toast: { info: mockToastInfo, success: mockToastSuccess, error: mockToastError } }));

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.push = mockPush;
    mockIsAuthenticated.mockReturnValue(true);
    mockGetUser.mockReturnValue({ id: 'user-1', username: '测试用户', email: 'test@example.com', createdAt: '2026-01-01T00:00:00.000Z' });
    mockUpdateProfile.mockResolvedValue({});
    mockChangePassword.mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      if (timeout === 4000 && typeof handler === 'function') {
        void Promise.resolve().then(() => handler(...args));
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('恢复 AI 画像与每日推荐，并在分析完成后自动刷新统计栏', async () => {
    mockGetFeed
      .mockResolvedValueOnce({ feed: [], profileStatus: 'ready' })
      .mockResolvedValueOnce({
        feed: [],
        profileStatus: 'ready',
        userProfile: { interests: [{ topic: '写作', score: 0.8 }], summary: '新的画像' },
      });
    mockGetStats
      .mockResolvedValueOnce({ totalNotes: 3, notesThisMonth: 1, notesThisWeek: 1, streakDays: 1, maxStreak: 2, totalWords: 120, avgWordsPerNote: 40, interestCount: 0, lastAnalyzedAt: null })
      .mockResolvedValueOnce({ totalNotes: 3, notesThisMonth: 1, notesThisWeek: 1, streakDays: 1, maxStreak: 2, totalWords: 120, avgWordsPerNote: 40, interestCount: 1, lastAnalyzedAt: '2026-08-01T08:00:00.000Z' });
    mockTriggerAnalysis.mockResolvedValue({ accepted: true, profileStatus: 'analyzing', analysisError: '' });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(mockGetFeed).toHaveBeenCalledTimes(1);
      expect(mockGetStats).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('AI 画像')).toBeInTheDocument();
    expect(screen.getByText('推荐笔记')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更新画像' }));
    await waitFor(() => expect(mockTriggerAnalysis).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetFeed).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(2));
    expect(mockToastSuccess).toHaveBeenCalledWith('分析任务已触发，分析完成后将自动刷新');
  });

  it('用来源说明呈现 AI 画像，并将推荐笔记作为语义链接', async () => {
    mockGetFeed.mockReset();
    mockGetStats.mockReset();
    mockGetFeed.mockResolvedValue({
      feed: [{ type: 'rediscover', title: '旧笔记', content: '重新阅读的内容', noteId: 'note-9', reason: '与你的写作主题相关' }],
      profileStatus: 'ready',
      userProfile: {
        interests: [{ topic: '写作', score: 0.92 }, { topic: '阅读', score: 0.75 }],
        expertise: [{ area: '内容整理', level: '熟悉' }],
        summary: '持续记录阅读与写作。',
        theme: { themeName: '静谧蓝', cssType: 'color', cssValue: '#9db9ff', reasoning: '来自近期笔记的主题。' },
      },
    });
    mockGetStats.mockResolvedValue({ totalNotes: 3, notesThisMonth: 1, notesThisWeek: 1, streakDays: 1, maxStreak: 2, totalWords: 120, avgWordsPerNote: 40, interestCount: 2, lastAnalyzedAt: '2026-08-01T08:00:00.000Z' });

    const { container } = render(<ProfilePage />);

    expect(await screen.findByText('兴趣主题（2）')).toBeInTheDocument();
    expect(screen.getByText('基于 2 个主题和你的笔记内容整理。')).toBeInTheDocument();
    expect(screen.queryByText('92%')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看笔记：旧笔记' })).toHaveAttribute('href', '/notes?highlight=note-9');
    expect(container.querySelector(`.${styles.themeAtmosphereSwatch}`)).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps atmosphere out of text-bearing surfaces and keeps profile text contrast-safe', () => {
    const avatarRule = profileStyles.match(/\.avatar, \.avatarPreview \{([^}]*)\}/)?.[1] || '';
    const heroRule = profileStyles.match(/\.profileHero \{([^}]*)\}/)?.[1] || '';
    const themePreviewRule = profileStyles.match(/\.themePreview \{([^}]*)\}/)?.[1] || '';

    expect(heroRule).toContain('background: var(--color-surface-raised)');
    expect(heroRule).not.toContain('var(--profile-atmosphere');
    expect(profileStyles).toMatch(/\.profileHero::before \{[^}]*var\(--profile-atmosphere-glow\)/);
    expect(avatarRule).toContain('background: var(--color-action-primary)');
    expect(avatarRule).toContain('color: var(--color-text-inverse)');
    expect(avatarRule).not.toContain('background: var(--profile-atmosphere');
    expect(themePreviewRule).toContain('background: var(--color-surface-raised)');
    expect(themePreviewRule).not.toContain('var(--profile-atmosphere');
    expect(atmosphereDeclarations).toEqual([
      { selector: '.profileHero::before', property: 'background', token: 'glow', value: 'radial-gradient(42rem 16rem at 8% 0%, var(--profile-atmosphere-glow), transparent 72%)' },
      { selector: '.avatar, .avatarPreview', property: 'box-shadow', token: 'accent', value: '0 0 0 .1875rem var(--profile-atmosphere-accent), 0 0 0 .375rem var(--profile-atmosphere-glow)' },
      { selector: '.avatar, .avatarPreview', property: 'box-shadow', token: 'glow', value: '0 0 0 .1875rem var(--profile-atmosphere-accent), 0 0 0 .375rem var(--profile-atmosphere-glow)' },
      { selector: '.themeAtmosphereSwatch', property: 'background', token: 'soft', value: 'var(--profile-atmosphere-soft)' },
      { selector: '.themeAtmosphereSwatch', property: 'box-shadow', token: 'accent', value: '0 0 0 .1875rem var(--profile-atmosphere-accent), 0 0 1.25rem var(--profile-atmosphere-glow)' },
      { selector: '.themeAtmosphereSwatch', property: 'box-shadow', token: 'glow', value: '0 0 0 .1875rem var(--profile-atmosphere-accent), 0 0 1.25rem var(--profile-atmosphere-glow)' },
    ]);

    for (const block of [tokenBlock(':root'), tokenBlock('.dark')]) {
      expect(contrast(hexToken(block, '--color-text-inverse'), hexToken(block, '--color-action-primary'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hexToken(block, '--color-text-secondary'), hexToken(block, '--color-surface-raised'))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives the named primary controls a 44px minimum target', () => {
    expect(profileStyles).toMatch(/\.btnPrimary, \.emptyState button \{[^}]*min-height: 2\.75rem/);
    expect(profileStyles).toMatch(/\.btnOutlineSm, \.btnGhostSm, \.btnCancel \{[^}]*min-height: 2\.75rem/);
    expect(profileStyles).toMatch(/\.profileActions \.btnOutlineSm \{[^}]*min-width: 2\.75rem/);
  });

  it('keeps Profile hero actions in-flow at narrow widths', () => {
    const narrowRule = profileStyles.match(/@media \(max-width: 420px\) \{([\s\S]*?)\n@media/ )?.[1] || '';
    expect(narrowRule).toContain('.profileHero { grid-template-columns: 1fr; }');
    expect(narrowRule).toContain('.profileActions { width: 100%; }');
    expect(narrowRule).toContain('.profileActions .btnOutlineSm { flex: 1 1 0; }');
    expect(narrowRule).not.toMatch(/\.profileActions[^}]*position:\s*(absolute|fixed)/);
  });
});

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './page';

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
  mockRouter: {
    push: vi.fn(),
  },
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

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('../../utils/auth', () => ({
  isAuthenticated: mockIsAuthenticated,
  getUser: mockGetUser,
}));

vi.mock('../../services/feedService', () => ({
  getFeed: mockGetFeed,
  getStats: mockGetStats,
  triggerAnalysis: mockTriggerAnalysis,
}));

vi.mock('../../services/userService', () => ({
  updateProfile: mockUpdateProfile,
  changePassword: mockChangePassword,
}));

vi.mock('../../components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

vi.mock('sonner', () => ({
  toast: {
    info: mockToastInfo,
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.push = mockPush;

    mockIsAuthenticated.mockReturnValue(true);
    mockGetUser.mockReturnValue({
      id: 'user-1',
      username: '测试用户',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

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

  it('在画像分析完成后会自动刷新统计栏', async () => {
    mockGetFeed
      .mockResolvedValueOnce({
        feed: [],
        profileStatus: 'ready',
      })
      .mockResolvedValueOnce({
        feed: [],
        profileStatus: 'ready',
        userProfile: {
          interests: [{ topic: '写作', score: 0.8 }],
          summary: '新的画像',
        },
      });

    mockGetStats
      .mockResolvedValueOnce({
        totalNotes: 3,
        notesThisMonth: 1,
        notesThisWeek: 1,
        streakDays: 1,
        maxStreak: 2,
        totalWords: 120,
        avgWordsPerNote: 40,
        interestCount: 0,
        lastAnalyzedAt: null,
      })
      .mockResolvedValueOnce({
        totalNotes: 3,
        notesThisMonth: 1,
        notesThisWeek: 1,
        streakDays: 1,
        maxStreak: 2,
        totalWords: 120,
        avgWordsPerNote: 40,
        interestCount: 1,
        lastAnalyzedAt: '2026-08-01T08:00:00.000Z',
      });

    mockTriggerAnalysis.mockResolvedValue({
      accepted: true,
      profileStatus: 'analyzing',
      analysisError: '',
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(mockGetFeed).toHaveBeenCalledTimes(1);
      expect(mockGetStats).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '更新画像' }));

    await waitFor(() => {
      expect(mockTriggerAnalysis).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockGetFeed).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(mockGetStats).toHaveBeenCalledTimes(2);
    });

    expect(mockToastSuccess).toHaveBeenCalledWith('分析任务已触发，分析完成后将自动刷新');
  });
});

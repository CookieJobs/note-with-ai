import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './page';

const { mockIsAuthenticated, mockGetUser, mockGetStats } = vi.hoisted(() => ({
  mockIsAuthenticated: vi.fn(), mockGetUser: vi.fn(), mockGetStats: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../utils/auth', () => ({ isAuthenticated: mockIsAuthenticated, getUser: mockGetUser }));
vi.mock('../../services/feedService', () => ({ getStats: mockGetStats }));
vi.mock('../../services/userService', () => ({ updateProfile: vi.fn(), changePassword: vi.fn() }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div /> }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

describe('ProfilePage', () => {
  beforeEach(() => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetUser.mockReturnValue({ username: '测试用户', email: 'test@example.com' });
    mockGetStats.mockResolvedValue({ totalNotes: 3, notesThisMonth: 1, notesThisWeek: 1, streakDays: 1, maxStreak: 2, totalWords: 120, avgWordsPerNote: 40, interestCount: 0, lastAnalyzedAt: null });
  });
  it('keeps account settings free from legacy AI profile and feed content', async () => {
    render(<ProfilePage />);
    expect(await screen.findByText('账户设置')).toBeInTheDocument();
    expect(screen.queryByText('AI 画像')).not.toBeInTheDocument();
    expect(screen.queryByText(/每日推荐/)).not.toBeInTheDocument();
  });
});

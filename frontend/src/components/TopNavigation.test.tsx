import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TopNavigation from './TopNavigation';

const { mockUsePathname, mockGetUser } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mockUsePathname,
}));

vi.mock('next/link', () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('../utils/auth', () => ({
  getUser: mockGetUser,
  logout: vi.fn(),
}));

describe('TopNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockReturnValue(null);
  });

  it('renders active notes tab as current page instead of a link', () => {
    mockUsePathname.mockReturnValue('/notes');

    render(<TopNavigation />);

    expect(screen.getByText('笔记')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: '笔记' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '聊天' })).toHaveAttribute('href', '/chat');
  });

  it('keeps notes tab navigable when current page is chat', () => {
    mockUsePathname.mockReturnValue('/chat');

    render(<TopNavigation />);

    expect(screen.getByRole('link', { name: '笔记' })).toHaveAttribute('href', '/notes');
    expect(screen.getByText('聊天')).toHaveAttribute('aria-current', 'page');
  });
});

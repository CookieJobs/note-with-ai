import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TopNavigation from './TopNavigation';

const { mockUsePathname, mockGetUser, mockGetUnviewedCount } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
  mockGetUser: vi.fn(),
  mockGetUnviewedCount: vi.fn(),
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

vi.mock('../services/inspirationService', () => ({ getUnviewedInspirationCount: mockGetUnviewedCount }));

describe('TopNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockReturnValue(null);
    mockGetUnviewedCount.mockResolvedValue(0);
  });

  it('renders active notes tab as current page instead of a link', () => {
    mockUsePathname.mockReturnValue('/notes');

    render(<TopNavigation />);

    expect(screen.getByText('笔记').closest('[aria-current="page"]')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '笔记' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '聊天' })).toHaveAttribute('href', '/chat');
  });

  it('keeps notes tab navigable when current page is chat', () => {
    mockUsePathname.mockReturnValue('/chat');

    render(<TopNavigation />);

    expect(screen.getByRole('link', { name: '笔记' })).toHaveAttribute('href', '/notes');
    expect(screen.getByText('聊天').closest('[aria-current="page"]')).toBeInTheDocument();
  });

  it('marks inspiration current and keeps notes and chat navigable', () => {
    mockUsePathname.mockReturnValue('/inspiration');

    render(<TopNavigation />);

    expect(screen.getByText('灵感').closest('[aria-current="page"]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '笔记' })).toHaveAttribute('href', '/notes');
    expect(screen.getByRole('link', { name: '聊天' })).toHaveAttribute('href', '/chat');
  });

  it('keeps the inspiration navigation active on its child routes', () => {
    mockUsePathname.mockReturnValue('/inspiration/example');

    render(<TopNavigation />);

    expect(screen.getByRole('link', { name: '灵感' })).toHaveAttribute('href', '/inspiration');
    expect(document.querySelector('nav')).toHaveAttribute('data-active-index', '2');
  });

  it('shows a server-owned new inspiration badge for a signed-in user', async () => {
    mockUsePathname.mockReturnValue('/notes');
    mockGetUser.mockReturnValue({ id: 'user-1' });
    mockGetUnviewedCount.mockResolvedValue(2);

    render(<TopNavigation />);

    expect(await screen.findByLabelText('2 条新灵感')).toBeInTheDocument();
    expect(mockGetUnviewedCount).toHaveBeenCalled();
  });

  it('refreshes the badge when an inspiration is marked viewed', async () => {
    mockUsePathname.mockReturnValue('/notes');
    mockGetUser.mockReturnValue({ id: 'user-1' });
    mockGetUnviewedCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    render(<TopNavigation />);
    expect(await screen.findByLabelText('1 条新灵感')).toBeInTheDocument();
    window.dispatchEvent(new Event('inspiration-count-changed'));
    await waitFor(() => expect(screen.queryByLabelText('1 条新灵感')).not.toBeInTheDocument());
  });
});

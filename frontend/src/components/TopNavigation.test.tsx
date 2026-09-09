import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import TopNavigation from './TopNavigation';

const stylesheet = readFileSync(join(process.cwd(), 'src/components/TopNavigation.module.scss'), 'utf8');

const { mockUsePathname, mockUseRouter, mockGetUser, mockLogout } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
  mockUseRouter: vi.fn(),
  mockGetUser: vi.fn(),
  mockLogout: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mockUsePathname,
  useRouter: mockUseRouter,
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
  logout: mockLogout,
}));

describe('TopNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockReturnValue(null);
    mockUseRouter.mockReturnValue({ push: vi.fn() });
  });

  it('exposes the brand as the home link instead of a page heading', () => {
    mockUsePathname.mockReturnValue('/notes');

    render(<TopNavigation />);

    expect(screen.getByRole('link', { name: 'NoteWithAI' })).toHaveAttribute('href', '/notes');
    expect(screen.queryByRole('heading', { name: 'NoteWithAI' })).not.toBeInTheDocument();
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

  it('marks the primary section as current for nested chat routes', () => {
    mockUsePathname.mockReturnValue('/chat/123');

    render(<TopNavigation />);

    expect(screen.getByText('聊天')).toHaveAttribute('aria-current', 'page');
  });

  it('opens and closes the account menu from the keyboard', async () => {
    mockUsePathname.mockReturnValue('/notes');
    mockGetUser.mockReturnValue({ username: 'Ada', email: 'ada@example.com' });

    render(<TopNavigation />);

    const trigger = await screen.findByRole('button', { name: 'Ada' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const menu = await screen.findByRole('menu', { name: '账户菜单' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu', { name: '账户菜单' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('routes to the profile from the account menu', async () => {
    const push = vi.fn();
    mockUsePathname.mockReturnValue('/notes');
    mockUseRouter.mockReturnValue({ push });
    mockGetUser.mockReturnValue({ username: 'Ada', email: 'ada@example.com' });

    render(<TopNavigation />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '个人中心' }));

    expect(push).toHaveBeenCalledWith('/profile');
  });

  it('logs out from the account menu', async () => {
    mockUsePathname.mockReturnValue('/notes');
    mockGetUser.mockReturnValue({ username: 'Ada', email: 'ada@example.com' });

    render(<TopNavigation />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出账户' }));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('keeps the mobile navigation as a no-wrap row below 768px', () => {
    expect(stylesheet).toMatch(
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.nav\s*\{[\s\S]*?(?:white-space:\s*nowrap|flex-wrap:\s*nowrap)/,
    );
  });
});

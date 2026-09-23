import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockPush, mockPathname, mockLogout, mockGetLatestInspiration, mockRequestInspiration, mockAuthenticated, mockGetUser } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPathname: vi.fn(),
  mockLogout: vi.fn(),
  mockGetLatestInspiration: vi.fn(),
  mockRequestInspiration: vi.fn(),
  mockAuthenticated: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), usePathname: mockPathname }));
vi.mock('../../utils/auth', () => ({ isAuthenticated: mockAuthenticated, getUser: mockGetUser, logout: mockLogout }));
vi.mock('../../services/inspirationService', async () => {
  const actual = await vi.importActual<typeof import('../../services/inspirationService')>('../../services/inspirationService');
  return { ...actual, getLatestInspiration: mockGetLatestInspiration, requestInspiration: mockRequestInspiration };
});

import InspirationPage from './page';
import { InspirationApiError } from '../../services/inspirationService';

const latest = {
  id: 'i1', topicLabel: '知识管理', headline: '把零散记录转成可检验的问题',
  brief: '先把想法变成可验证假设【1】。', whyRelevant: '你近期多次记录了知识整理。',
  nextQuestion: '哪条笔记最值得先验证？', createdAt: '2026-09-22T00:00:00.000Z',
  sources: [{ sourceId: '1', canonicalUrl: 'https://example.com/source', title: '来源标题',
    publisher: 'example.com', snippet: '来源摘要', retrievedAt: '2026-09-22T00:00:00.000Z' }],
};

describe('InspirationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticated.mockReturnValue(true);
    mockGetUser.mockReturnValue({ id: 'user-1' });
    mockPathname.mockReturnValue('/inspiration');
    mockGetLatestInspiration.mockResolvedValue(null);
    mockRequestInspiration.mockResolvedValue({ status: 'created', item: latest });
  });

  it('shows a cited research card before its source list and discloses the data boundary', async () => {
    mockGetLatestInspiration.mockResolvedValue(latest);

    render(<InspirationPage />);

    expect(await screen.findByText('把零散记录转成可检验的问题')).toBeInTheDocument();
    expect(screen.getByText(/不会发送笔记正文/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '参考来源：来源标题' })).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByRole('link', { name: '查看来源：来源标题' })).toHaveAttribute('href', 'https://example.com/source');
    expect(screen.getByRole('link', { name: '参考来源：来源标题' })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('参考来源').compareDocumentPosition(screen.getByRole('link', { name: '参考来源：来源标题' })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('disables duplicate requests and restores retry after provider failure', async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    mockRequestInspiration.mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    render(<InspirationPage />);

    const button = await screen.findByRole('button', { name: '为我研究一条灵感' });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '正在检索并整理来源…' })).toBeDisabled();
    rejectRequest?.(new InspirationApiError('SEARCH_PROVIDER_FAILED', 502, '检索服务暂时不可用'));
    await screen.findByText('检索服务暂时不可用，请重试。');
    expect(screen.getByRole('button', { name: '为我研究一条灵感' })).toBeEnabled();
  });

  it('shows a directed no-result state and allows a new manual request', async () => {
    mockRequestInspiration.mockResolvedValue({ status: 'no_result' });
    render(<InspirationPage />);

    fireEvent.click(await screen.findByRole('button', { name: '为我研究一条灵感' }));

    expect(await screen.findByText('这次没有找到可展示的新来源。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '为我研究一条灵感' })).toBeEnabled();
  });

  it('does not load the current user result until the auth guard resolves a user', async () => {
    mockAuthenticated.mockReturnValue(false);
    mockGetUser.mockReturnValue(null);

    render(<InspirationPage />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/auth'));
    expect(mockGetLatestInspiration).not.toHaveBeenCalled();
  });

  it('does not expose save, dismiss, history, scheduling, or notification actions', async () => {
    render(<InspirationPage />);

    await screen.findByRole('button', { name: '为我研究一条灵感' });
    expect(screen.queryByText(/保存|不感兴趣|历史记录|定时推送|通知/)).not.toBeInTheDocument();
  });
});

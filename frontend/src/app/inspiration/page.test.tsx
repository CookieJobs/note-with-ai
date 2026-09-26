import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockPush, mockPathname, mockLogout, mockGetLatestInspiration, mockRequestInspiration, mockAuthenticated, mockGetUser, mockListInspirations, mockGetInspiration, mockChangeInspirationState, mockMarkInspirationViewed } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPathname: vi.fn(),
  mockLogout: vi.fn(),
  mockGetLatestInspiration: vi.fn(),
  mockRequestInspiration: vi.fn(),
  mockAuthenticated: vi.fn(),
  mockGetUser: vi.fn(),
  mockListInspirations: vi.fn(),
  mockGetInspiration: vi.fn(),
  mockChangeInspirationState: vi.fn(),
  mockMarkInspirationViewed: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), usePathname: mockPathname }));
vi.mock('../../utils/auth', () => ({ isAuthenticated: mockAuthenticated, getUser: mockGetUser, logout: mockLogout }));
vi.mock('../../services/inspirationService', async () => {
  const actual = await vi.importActual<typeof import('../../services/inspirationService')>('../../services/inspirationService');
  return { ...actual, getLatestInspiration: mockGetLatestInspiration, requestInspiration: mockRequestInspiration,
    listInspirations: mockListInspirations, getInspiration: mockGetInspiration,
    changeInspirationState: mockChangeInspirationState, markInspirationViewed: mockMarkInspirationViewed };
});

import InspirationPage from './page';
import { InspirationApiError } from '../../services/inspirationService';

const latest = {
  id: 'i1', topicLabel: '知识管理', headline: '把零散记录转成可检验的问题',
  brief: '先把想法变成可验证假设【1】。', whyRelevant: '你近期多次记录了知识整理。',
  nextQuestion: '哪条笔记最值得先验证？', createdAt: '2026-09-22T00:00:00.000Z',
  userState: 'regular' as const, origin: 'manual' as const, viewedAt: null,
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
    mockListInspirations.mockResolvedValue({ items: [], nextCursor: null });
    mockGetInspiration.mockResolvedValue(latest);
    mockMarkInspirationViewed.mockResolvedValue(latest);
    mockChangeInspirationState.mockResolvedValue({ ...latest, userState: 'saved' });
    mockRequestInspiration.mockResolvedValue({ status: 'created', item: latest });
  });

  it('shows a cited research card before its source list and discloses the data boundary', async () => {
    mockListInspirations.mockResolvedValue({ items: [latest], nextCursor: null });

    render(<InspirationPage />);

    expect(await screen.findByRole('heading', { level: 1, name: '把零散记录转成可检验的问题' })).toBeInTheDocument();
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
    expect(mockListInspirations).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '为我研究一条灵感' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '为我研究一条灵感' }));
    expect(mockRequestInspiration).not.toHaveBeenCalled();
  });

  it('shows saved results in both recent and saved views after organizing one result', async () => {
    mockListInspirations.mockImplementation(async (view: string) => ({ items: view === 'recent' ? [latest] : [], nextCursor: null }));
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '保存灵感' }));
    expect(await screen.findByRole('button', { name: '取消保存' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '把零散记录转成可检验的问题' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '已保存' }));
    expect(mockListInspirations).toHaveBeenCalledWith('saved', null);
  });

  it('places load more after the final history entry and keeps the first page on failure', async () => {
    mockListInspirations.mockResolvedValueOnce({ items: [latest], nextCursor: 'page-2' })
      .mockRejectedValueOnce(new Error('offline'));
    render(<InspirationPage />);
    const row = await screen.findByRole('button', { name: /把零散记录转成可检验的问题/ });
    const more = screen.getByRole('button', { name: '加载更多灵感' });
    expect(row.compareDocumentPosition(more)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(more);
    expect(await screen.findByText(/加载失败/)).toBeInTheDocument();
    expect(row).toBeInTheDocument();
    expect(more).toBeEnabled();
  });

  it('retains visible results when save fails', async () => {
    mockListInspirations.mockResolvedValue({ items: [latest], nextCursor: null });
    mockChangeInspirationState.mockRejectedValue(new Error('offline'));
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '保存灵感' }));
    expect(await screen.findByText(/操作未成功/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '把零散记录转成可检验的问题' })).toBeInTheDocument();
  });
});

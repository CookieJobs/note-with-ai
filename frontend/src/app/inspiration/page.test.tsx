import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { mockPush, mockPathname, mockLogout, mockGetLatestInspiration, mockRequestInspiration, mockAuthenticated, mockGetUser, mockListInspirations, mockGetInspiration, mockChangeInspirationState, mockMarkInspirationViewed, mockGetSettings, mockSetEnabled, mockGetCount } = vi.hoisted(() => ({
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
  mockGetSettings: vi.fn(),
  mockSetEnabled: vi.fn(),
  mockGetCount: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), usePathname: mockPathname }));
vi.mock('../../utils/auth', () => ({ isAuthenticated: mockAuthenticated, getUser: mockGetUser, logout: mockLogout }));
vi.mock('../../services/inspirationService', async () => {
  const actual = await vi.importActual<typeof import('../../services/inspirationService')>('../../services/inspirationService');
  return { ...actual, getLatestInspiration: mockGetLatestInspiration, requestInspiration: mockRequestInspiration,
    listInspirations: mockListInspirations, getInspiration: mockGetInspiration,
    changeInspirationState: mockChangeInspirationState, markInspirationViewed: mockMarkInspirationViewed,
    getInspirationSettings: mockGetSettings, setInspirationEnabled: mockSetEnabled, getUnviewedInspirationCount: mockGetCount };
});

import InspirationPage from './page';
import { InspirationApiError, type InspirationItem } from '../../services/inspirationService';
import { WorkspaceContext } from '../../components/workspace/WorkspaceContext';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }

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
    mockGetSettings.mockResolvedValue({ enabled: false, consentedAt: null, nextEligibleAt: null, lastAttemptAt: null, lastStatus: null });
    mockSetEnabled.mockImplementation(async (enabled: boolean) => ({ enabled, consentedAt: '2026-09-22T00:00:00Z', nextEligibleAt: '2026-09-23T00:00:00Z', lastAttemptAt: null, lastStatus: null }));
    mockGetCount.mockResolvedValue(0);
    mockChangeInspirationState.mockResolvedValue({ ...latest, userState: 'saved' });
    mockRequestInspiration.mockResolvedValue({ status: 'created', item: latest });
  });

  it('starts source excerpts collapsed and resets them when opening another item with the same source', async () => {
    const source = { ...latest.sources[0], snippet: '# 来源标题\n' + '完整摘录'.repeat(80) };
    const first = { ...latest, viewedAt: '2026-09-22T00:00:00Z', sources: [source] };
    const second = { ...first, id: 'i2', headline: '另一条灵感' };
    mockListInspirations.mockResolvedValue({ items: [first, second], nextCursor: null });
    mockGetInspiration.mockResolvedValue(second);
    render(<InspirationPage />);
    const toggle = await screen.findByRole('button', { name: '展开来源摘录' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '收起来源摘录' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '参考来源：来源标题' })).toHaveAttribute('href', source.canonicalUrl);
    fireEvent.click(screen.getByRole('button', { name: /另一条灵感/ }));
    await screen.findByRole('heading', { name: '另一条灵感', level: 1 });
    expect(screen.getByRole('button', { name: '展开来源摘录' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '收起来源摘录' })).toBeNull();
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

  it('explains pending context while retaining an existing inspiration', async () => {
    mockListInspirations.mockResolvedValue({ items: [latest], nextCursor: null });
    mockRequestInspiration.mockRejectedValue(new InspirationApiError('INSPIRATION_NOTE_CONTEXT_UNAVAILABLE', 409, 'pending', 'summary_pending'));
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '为我研究一条灵感' }));
    expect(await screen.findByText('近期笔记的摘要正在准备中，请稍后再试。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: latest.headline })).toBeInTheDocument();
  });

  it('describes scheduled context unavailability without claiming search ran', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, consentedAt: null, nextEligibleAt: null, lastAttemptAt: null,
      lastStatus: 'no_result', lastReason: 'note_context_unavailable', lastContextReason: 'no_notes' });
    render(<InspirationPage />);
    expect(await screen.findByText(/最近一次检查未开始检索：请先记录一篇笔记/)).toBeInTheDocument();
    expect(screen.queryByText('最近一次检查没有发现新的来源。')).not.toBeInTheDocument();
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

  it('shows default-off scheduled discovery with its privacy and frequency disclosure', async () => {
    render(<InspirationPage />);
    expect(await screen.findByRole('switch', { name: '定期为我寻找灵感' })).not.toBeChecked();
    expect(screen.getByText(/每 24 小时最多尝试一次/)).toBeInTheDocument();
    expect(screen.getByText(/Tavily 仅接收搜索查询/)).toBeInTheDocument();
  });

  it('enables scheduled discovery only after saving and shows the local next-check time', async () => {
    render(<InspirationPage />);
    const toggle = await screen.findByRole('switch', { name: '定期为我寻找灵感' });
    fireEvent.click(toggle);
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByRole('switch', { name: '定期为我寻找灵感' })).toBeChecked());
    expect(screen.getByText(/下次可检查/)).toBeInTheDocument();
  });

  it('keeps the setting unchanged and re-enables the switch after an update failure', async () => {
    mockSetEnabled.mockRejectedValue(new Error('offline'));
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('switch', { name: '定期为我寻找灵感' }));
    expect(await screen.findByText(/设置未能保存/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '定期为我寻找灵感' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: '定期为我寻找灵感' })).toBeEnabled();
  });

  it('marks a scheduled history item viewed when opened and refreshes the new count', async () => {
    const scheduled = { ...latest, id: 'i2', headline: '新的研究主题', origin: 'scheduled' as const, viewedAt: null };
    mockListInspirations.mockResolvedValue({ items: [{ ...latest, viewedAt: '2026-09-22T00:00:00Z' }, scheduled], nextCursor: null });
    mockGetInspiration.mockResolvedValue(scheduled);
    mockMarkInspirationViewed.mockResolvedValue({ ...scheduled, viewedAt: '2026-09-26T00:00:00Z' });
    mockGetCount.mockImplementation(async () => mockMarkInspirationViewed.mock.calls.length > 0 ? 0 : 1);
    render(<InspirationPage />);
    expect(await screen.findByText('1 条新灵感')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /新的研究主题/ }));
    await waitFor(() => expect(mockMarkInspirationViewed).toHaveBeenCalledWith('i2'));
    expect(await screen.findByText('研究过的内容都会留在这里')).toBeInTheDocument();
  });
  it('keeps B selected when the earlier A detail request arrives last', async () => {
    const a = { ...latest, id: 'a', headline: '历史 A', viewedAt: '2026-09-22T00:00:00Z' };
    const b = { ...a, id: 'b', headline: '历史 B' };
    const late = deferred<InspirationItem>();
    mockListInspirations.mockResolvedValue({ items: [{ ...latest, viewedAt: a.viewedAt }, a, b], nextCursor: null });
    mockGetInspiration.mockImplementation((id: string) => id === 'a' ? late.promise : Promise.resolve(b));
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: /历史 A/ }));
    fireEvent.click(screen.getByRole('button', { name: /历史 B/ }));
    await screen.findByRole('heading', { name: '历史 B', level: 1 });
    await act(async () => { late.resolve(a); await late.promise; });
    expect(screen.getByRole('heading', { name: '历史 B', level: 1 })).toBeInTheDocument();
  });

  it('keeps B selected when marking the earlier A viewed completes late', async () => {
    const a = { ...latest, id: 'a', headline: '历史 A' };
    const b = { ...latest, id: 'b', headline: '历史 B', viewedAt: '2026-09-22T00:00:00Z' };
    const late = deferred<InspirationItem>();
    mockListInspirations.mockResolvedValue({ items: [b, a], nextCursor: null });
    mockGetInspiration.mockImplementation(async (id: string) => id === 'a' ? a : b);
    mockMarkInspirationViewed.mockReturnValue(late.promise);
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: /历史 A/ }));
    await screen.findByRole('heading', { name: '历史 A', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: /历史 B/ }));
    await screen.findByRole('heading', { name: '历史 B', level: 1 });
    await act(async () => { late.resolve({ ...a, viewedAt: b.viewedAt }); await late.promise; });
    expect(screen.getByRole('heading', { name: '历史 B', level: 1 })).toBeInTheDocument();
  });

  it('does not replace a history choice with a generated result or its late viewed response', async () => {
    const history = { ...latest, viewedAt: '2026-09-22T00:00:00Z' };
    const generated = { ...latest, id: 'generated', headline: '新研究' };
    const research = deferred<{ status: 'created'; item: InspirationItem }>();
    const viewed = deferred<InspirationItem>();
    mockListInspirations.mockResolvedValue({ items: [history], nextCursor: null });
    mockGetInspiration.mockResolvedValue(history);
    mockRequestInspiration.mockReturnValue(research.promise); mockMarkInspirationViewed.mockReturnValue(viewed.promise);
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '为我研究一条灵感' }));
    fireEvent.click(screen.getByRole('button', { name: /把零散记录转成可检验的问题/ }));
    await act(async () => { research.resolve({ status: 'created', item: generated }); await research.promise; });
    await act(async () => { viewed.resolve({ ...generated, viewedAt: history.viewedAt }); await viewed.promise; });
    expect(screen.getByRole('heading', { name: history.headline, level: 1 })).toBeInTheDocument();
  });

  it('does not let the initial viewed request replace a later history choice', async () => {
    const history = { ...latest, id: 'history', headline: '已选择历史', viewedAt: '2026-09-22T00:00:00Z' };
    const late = deferred<InspirationItem>();
    mockListInspirations.mockResolvedValue({ items: [latest, history], nextCursor: null });
    mockGetInspiration.mockResolvedValue(history); mockMarkInspirationViewed.mockReturnValue(late.promise);
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: /已选择历史/ }));
    await screen.findByRole('heading', { name: history.headline, level: 1 });
    await act(async () => { late.resolve({ ...latest, viewedAt: history.viewedAt }); await late.promise; });
    expect(screen.getByRole('heading', { name: history.headline, level: 1 })).toBeInTheDocument();
  });

  it('uses the supplied workspace settings without a second settings request', async () => {
    const openSettings = vi.fn();
    const controller = { settings: { enabled: false, consentedAt: null, nextEligibleAt: null, lastAttemptAt: null, lastStatus: null, lastReason: null, lastContextReason: null }, loading: false, saving: false, error: null, refetch: vi.fn(), setEnabled: vi.fn() };
    render(<WorkspaceContext.Provider value={{ navigate: vi.fn(), requestAction: vi.fn(), registerEditor: vi.fn(), setRecentNotes: vi.fn(), openSettings, inspirationSettings: controller }}><InspirationPage /></WorkspaceContext.Provider>);
    await waitFor(() => expect(screen.getByRole('button', { name: '为我研究一条灵感' })).toBeEnabled());
    expect(mockGetSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '管理定期发现' }));
    expect(openSettings).toHaveBeenCalledWith('inspiration');
  });

  it('allows manual research when scheduled settings failed to load', async () => {
    mockGetSettings.mockRejectedValue(new Error('offline'));
    render(<InspirationPage />);
    await screen.findByText('暂时无法加载定期发现设置。');
    fireEvent.click(screen.getByRole('button', { name: '为我研究一条灵感' }));
    await waitFor(() => expect(mockRequestInspiration).toHaveBeenCalledTimes(1));
  });

  it('keeps the new history selection after a generated item was displayed and its viewed response arrives late', async () => {
    const history = { ...latest, viewedAt: '2026-09-22T00:00:00Z' };
    const generated = { ...latest, id: 'generated', headline: '新研究' };
    const viewed = deferred<InspirationItem>();
    mockListInspirations.mockResolvedValue({ items: [history], nextCursor: null });
    mockGetInspiration.mockResolvedValue(history);
    mockRequestInspiration.mockResolvedValue({ status: 'created', item: generated }); mockMarkInspirationViewed.mockReturnValue(viewed.promise);
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '为我研究一条灵感' }));
    await screen.findByRole('heading', { name: '新研究', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: /把零散记录转成可检验的问题/ }));
    await screen.findByRole('heading', { name: history.headline, level: 1 });
    await act(async () => { viewed.resolve({ ...generated, viewedAt: history.viewedAt }); await viewed.promise; });
    expect(screen.getByRole('heading', { name: history.headline, level: 1 })).toBeInTheDocument();
  });

  it('keeps manual research available after scheduled settings fail to save', async () => {
    mockSetEnabled.mockRejectedValue(new Error('offline'));
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('switch', { name: '定期为我寻找灵感' }));
    await screen.findByText('设置未能保存，请重试。');
    fireEvent.click(screen.getByRole('button', { name: '为我研究一条灵感' }));
    await waitFor(() => expect(mockRequestInspiration).toHaveBeenCalledTimes(1));
  });

  it('renders real source numbering and labels retrievedAt as retrieval time', async () => {
    mockListInspirations.mockResolvedValue({ items: [{ ...latest, viewedAt: '2026-09-22T00:00:00Z' }], nextCursor: null });
    render(<InspirationPage />);
    const source = await screen.findByRole('link', { name: '参考来源：来源标题' });
    expect(source).toHaveTextContent('1');
    expect(screen.getByText(/检索于/)).toHaveTextContent('example.com');
    expect(screen.queryByText(/发布于/)).not.toBeInTheDocument();
  });

  it('does not replace a later detail choice with an earlier save response', async () => {
    const first = { ...latest, viewedAt: '2026-09-22T00:00:00Z' };
    const second = { ...first, id: 'second', headline: '新选择' };
    const pending = deferred<InspirationItem>();
    mockListInspirations.mockResolvedValue({ items: [first, second], nextCursor: null });
    mockGetInspiration.mockResolvedValue(second); mockChangeInspirationState.mockReturnValue(pending.promise);
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '保存灵感' }));
    fireEvent.click(screen.getByRole('button', { name: /新选择/ }));
    await screen.findByRole('heading', { name: '新选择', level: 1 });
    await act(async () => { pending.resolve({ ...first, userState: 'saved' }); await pending.promise; });
    expect(screen.getByRole('heading', { name: '新选择', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存灵感' })).toBeEnabled();
  });

  it('marks an automatically displayed scheduled fallback viewed and synchronizes its unread marker and count', async () => {
    const a = { ...latest, viewedAt: '2026-09-22T00:00:00Z' };
    const b = { ...latest, id: 'scheduled-b', headline: '自动展示 B', origin: 'scheduled' as const };
    const viewed = deferred<InspirationItem>();
    let serverCount = 1;
    mockListInspirations.mockResolvedValue({ items: [a, b], nextCursor: null });
    mockChangeInspirationState.mockResolvedValue({ ...a, userState: 'dismissed' });
    mockMarkInspirationViewed.mockReturnValue(viewed.promise);
    mockGetCount.mockImplementation(async () => serverCount);
    render(<InspirationPage />);
    await screen.findByText('1 条新灵感');
    fireEvent.click(await screen.findByRole('button', { name: '忽略' }));
    await screen.findByRole('heading', { name: b.headline, level: 1 });
    expect(mockMarkInspirationViewed).toHaveBeenCalledWith(b.id);
    const row = screen.getByRole('button', { name: /自动展示 B/ });
    expect(within(row).getByText('新')).toBeInTheDocument();
    await act(async () => {
      serverCount = 0;
      viewed.resolve({ ...b, viewedAt: '2026-10-25T10:00:00Z' });
      await viewed.promise;
    });
    await screen.findByText('研究过的内容都会留在这里');
    expect(within(row).queryByText('新')).not.toBeInTheDocument();
  });

  it('does not let an automatically displayed fallback viewed response replace a newer history choice', async () => {
    const a = { ...latest, viewedAt: '2026-09-22T00:00:00Z' };
    const b = { ...latest, id: 'scheduled-b', headline: '自动展示 B', origin: 'scheduled' as const };
    const c = { ...a, id: 'history-c', headline: '随后选择 C' };
    const viewed = deferred<InspirationItem>();
    mockListInspirations.mockResolvedValue({ items: [a, b, c], nextCursor: null });
    mockChangeInspirationState.mockResolvedValue({ ...a, userState: 'dismissed' });
    mockGetInspiration.mockResolvedValue(c); mockMarkInspirationViewed.mockReturnValue(viewed.promise);
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '忽略' }));
    await screen.findByRole('heading', { name: b.headline, level: 1 });
    expect(mockMarkInspirationViewed).toHaveBeenCalledWith(b.id);
    fireEvent.click(screen.getByRole('button', { name: /随后选择 C/ }));
    await screen.findByRole('heading', { name: c.headline, level: 1 });
    await act(async () => { viewed.resolve({ ...b, viewedAt: '2026-10-25T10:00:00Z' }); await viewed.promise; });
    expect(screen.getByRole('heading', { name: c.headline, level: 1 })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /自动展示 B/ })).queryByText('新')).not.toBeInTheDocument();
  });

  it('does not cache a late empty saved query over a newer successful save', async () => {
    const a = { ...latest, viewedAt: '2026-09-22T00:00:00Z' };
    const stale = deferred<{ items: InspirationItem[]; nextCursor: string | null }>();
    let saved = false;
    mockListInspirations.mockImplementation((view: string) => {
      if (view === 'recent') return Promise.resolve({ items: [a], nextCursor: null });
      return saved ? Promise.resolve({ items: [{ ...a, userState: 'saved' }], nextCursor: null }) : stale.promise;
    });
    mockChangeInspirationState.mockImplementation(async () => { saved = true; return { ...a, userState: 'saved' }; });
    render(<InspirationPage />);
    await screen.findByRole('heading', { name: a.headline, level: 1 });
    fireEvent.click(screen.getByRole('tab', { name: '已保存' }));
    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    fireEvent.click(screen.getByRole('button', { name: '保存灵感' }));
    await screen.findByRole('button', { name: '取消保存' });
    await act(async () => { stale.resolve({ items: [], nextCursor: null }); await stale.promise; });
    fireEvent.click(screen.getByRole('tab', { name: '已保存' }));
    const panel = screen.getByRole('tabpanel', { name: '已保存灵感' });
    expect(await within(panel).findByRole('button', { name: new RegExp(a.headline) })).toHaveTextContent('已保存');
    expect(within(panel).queryByText('这里还没有已保存的灵感。')).not.toBeInTheDocument();
  });

  it('does not reintroduce a dismissed item from a late pagination snapshot and keeps the server cursor', async () => {
    const a = { ...latest, viewedAt: '2026-09-22T00:00:00Z' };
    const b = { ...a, id: 'later-b', headline: '分页 B' };
    const c = { ...a, id: 'later-c', headline: '分页 C' };
    const stale = deferred<{ items: InspirationItem[]; nextCursor: string | null }>();
    let dismissed = false;
    mockListInspirations.mockImplementation((_view: string, cursor: string | null) => {
      if (!cursor) return Promise.resolve({ items: [a, b], nextCursor: 'server-page-2' });
      if (cursor === 'server-page-3') return Promise.resolve({ items: [], nextCursor: null });
      return dismissed ? Promise.resolve({ items: [c], nextCursor: 'server-page-3' }) : stale.promise;
    });
    mockChangeInspirationState.mockImplementation(async () => { dismissed = true; return { ...a, userState: 'dismissed' }; });
    render(<InspirationPage />);
    fireEvent.click(await screen.findByRole('button', { name: '加载更多灵感' }));
    fireEvent.click(screen.getByRole('button', { name: '忽略' }));
    await screen.findByRole('heading', { name: b.headline, level: 1 });
    await act(async () => { stale.resolve({ items: [a, c], nextCursor: 'server-page-3' }); await stale.promise; });
    const panel = screen.getByRole('tabpanel', { name: '最近灵感' });
    await within(panel).findByRole('button', { name: new RegExp(c.headline) });
    expect(within(panel).queryByRole('button', { name: new RegExp(a.headline) })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多灵感' }));
    await waitFor(() => expect(mockListInspirations).toHaveBeenCalledWith('recent', 'server-page-3'));
  });

  it('does not restore an unsaved item from a late saved pagination snapshot', async () => {
    const a = { ...latest, userState: 'saved' as const, viewedAt: '2026-09-22T00:00:00Z' };
    const b = { ...a, id: 'saved-b', headline: '收藏 B' };
    const c = { ...a, id: 'saved-c', headline: '收藏 C' };
    const stale = deferred<{ items: InspirationItem[]; nextCursor: string | null }>();
    let unsaved = false;
    mockListInspirations.mockImplementation((view: string, cursor: string | null) => {
      if (view === 'recent') return Promise.resolve({ items: [a, b], nextCursor: null });
      if (!cursor) return Promise.resolve({ items: [a, b], nextCursor: 'saved-page-2' });
      return unsaved ? Promise.resolve({ items: [c], nextCursor: null }) : stale.promise;
    });
    mockChangeInspirationState.mockImplementation(async () => { unsaved = true; return { ...a, userState: 'regular' }; });
    render(<InspirationPage />);
    await screen.findByRole('button', { name: '取消保存' });
    fireEvent.click(screen.getByRole('tab', { name: '已保存' }));
    fireEvent.click(await screen.findByRole('button', { name: '加载更多灵感' }));
    fireEvent.click(screen.getByRole('button', { name: '取消保存' }));
    await screen.findByRole('heading', { name: b.headline, level: 1 });
    await act(async () => { stale.resolve({ items: [a, c], nextCursor: null }); await stale.promise; });
    const panel = screen.getByRole('tabpanel', { name: '已保存灵感' });
    await within(panel).findByRole('button', { name: new RegExp(c.headline) });
    expect(within(panel).queryByRole('button', { name: new RegExp(a.headline) })).not.toBeInTheDocument();
  });

});

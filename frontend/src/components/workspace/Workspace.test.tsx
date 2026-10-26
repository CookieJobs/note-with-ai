import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceRoot from './WorkspaceRoot';
import { useWorkspace, type WorkspaceChatNavigation, type WorkspaceContextValue, type WorkspaceRecentNote } from './WorkspaceContext';

const { pathname, push, readUser, unread, profileSave, fetchNotes } = vi.hoisted(() => ({
  pathname: vi.fn(), push: vi.fn(), readUser: vi.fn(), unread: vi.fn(), profileSave: vi.fn(), fetchNotes: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: pathname, useRouter: () => ({ push }) }));
vi.mock('../../utils/auth', () => ({ getUser: readUser, logout: vi.fn(), authFetch: fetchNotes }));
vi.mock('../../services/inspirationService', () => ({ getUnviewedInspirationCount: unread }));
vi.mock('../../hooks/useInspirationSettings', () => ({ useInspirationSettings: () => ({ settings: { enabled: false }, loading: false, saving: false, error: null, refetch: vi.fn(), setEnabled: vi.fn() }) }));
vi.mock('../../services/userService', () => ({ updateProfile: profileSave, changePassword: vi.fn() }));

const selectChat = vi.fn(), newChat = vi.fn();
const chatNavigation: WorkspaceChatNavigation = { sessions: [{ id: 'c1', title: '一段真实历史', messages: [{ role: 'user', content: '问题' }] }], currentSessionId: 'c1', isClient: true, onSessionSelect: selectChat, onNewSession: newChat, onDeleteSession: vi.fn() };
let workspaceValue: WorkspaceContextValue | null = null;
function WorkspaceProbe() {
  const workspace = useWorkspace(); workspaceValue = workspace;
  useEffect(() => workspace?.registerChatNavigation?.(chatNavigation), [workspace?.registerChatNavigation]);
  return <><input aria-label="业务草稿" defaultValue="保留它" /><button onClick={() => workspace?.openSettings?.('inspiration')}>打开灵感设置</button><button onClick={() => workspace?.openSettings?.('account')}>打开账户设置</button></>;
}
function RecentNotesProbe({ notes }: { notes: WorkspaceRecentNote[] }) {
  const setRecentNotes = useWorkspace()?.setRecentNotes;
  useEffect(() => setRecentNotes?.(notes), [setRecentNotes, notes]);
  return null;
}
const notesReply = (notes: { _id: string; title?: string; contentText?: string }[]) => ({ ok: true, json: async () => ({ success: true, data: { notes, pageInfo: { hasMore: true, nextCursor: 'next-page' } } }) });

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  pathname.mockReturnValue('/notes');
  localStorage.setItem('user', JSON.stringify({ id: 'u1', username: '测试用户', email: 'test@example.com', createdAt: '2026-10-20' }));
  readUser.mockImplementation(() => JSON.parse(localStorage.getItem('user') || 'null'));
  unread.mockResolvedValue(0);
  fetchNotes.mockResolvedValue(notesReply([]));
});

describe('轻量最近笔记投影', () => {
  it('loads the first five real notes on a cold profile entry without priming the notes query', async () => {
    pathname.mockReturnValue('/profile');
    fetchNotes.mockResolvedValue(notesReply([
      { _id: 'note /1', title: '', contentText: '正文辨认文字' },
      ...[2, 3, 4, 5, 6].map(id => ({ _id: `note-${id}`, title: `真实笔记${id}` })),
    ]));
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot></QueryClientProvider>);
    expect(await screen.findByRole('link', { name: '正文辨认文字' })).toHaveAttribute('href', '/notes?highlight=note%20%2F1');
    const recent = screen.getByRole('region', { name: '最近笔记' });
    expect(within(recent).getAllByRole('link')).toHaveLength(5);
    expect(within(recent).queryByText('真实笔记6')).not.toBeInTheDocument();
    expect(within(recent).queryByText('无标题')).not.toBeInTheDocument();
    expect(fetchNotes).toHaveBeenCalledWith('/api/notes', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(queryClient.getQueryData(['notes'])).toBeUndefined();
  });
  it('keeps a later authoritative page projection when the cold-entry request finishes late', async () => {
    pathname.mockReturnValue('/profile');
    let resolve!: (response: ReturnType<typeof notesReply>) => void;
    fetchNotes.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    await waitFor(() => expect(fetchNotes).toHaveBeenCalledOnce());
    act(() => workspaceValue!.setRecentNotes([{ id: 'canonical', title: '笔记页最新版本', href: '/notes?highlight=canonical' }]));
    await act(async () => resolve(notesReply([{ _id: 'stale', title: '迟到旧版本' }])));
    expect(screen.getByRole('link', { name: '笔记页最新版本' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '迟到旧版本' })).not.toBeInTheDocument();
  });
  it('does not show the previous user response after the workspace identity changes', async () => {
    pathname.mockReturnValue('/profile');
    let resolveA!: (response: ReturnType<typeof notesReply>) => void;
    let resolveB!: (response: ReturnType<typeof notesReply>) => void;
    fetchNotes.mockReturnValueOnce(new Promise(r => { resolveA = r; })).mockReturnValueOnce(new Promise(r => { resolveB = r; }));
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    await waitFor(() => expect(fetchNotes).toHaveBeenCalledOnce());
    localStorage.setItem('user', JSON.stringify({ id: 'u2', username: '用户B', email: 'b@example.com', createdAt: '2026-10-20' }));
    fireEvent.click(screen.getByRole('button', { name: '打开账户设置' }));
    await waitFor(() => expect(fetchNotes).toHaveBeenCalledTimes(2));
    await act(async () => resolveB(notesReply([{ _id: 'b', title: '用户B的笔记' }])));
    await act(async () => resolveA(notesReply([{ _id: 'a', title: '用户A的笔记' }])));
    expect(screen.getByRole('link', { name: '用户B的笔记' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '用户A的笔记' })).not.toBeInTheDocument();
  });
  it('ignores the previous route response and retains the current route projection', async () => {
    pathname.mockReturnValue('/profile');
    let resolveOld!: (response: ReturnType<typeof notesReply>) => void;
    fetchNotes.mockReturnValueOnce(new Promise(r => { resolveOld = r; })).mockResolvedValue(notesReply([{ _id: 'current', title: '当前路由记录' }]));
    const view = render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    await waitFor(() => expect(fetchNotes).toHaveBeenCalledOnce());
    pathname.mockReturnValue('/inspiration'); view.rerender(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    expect(await screen.findByRole('link', { name: '当前路由记录' })).toBeInTheDocument();
    await act(async () => resolveOld(notesReply([{ _id: 'old', title: '旧路由迟到记录' }])));
    expect(screen.queryByRole('link', { name: '旧路由迟到记录' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '当前路由记录' })).toBeInTheDocument();
  });
  it('aborts a pending projection on unmount and isolates the next shell', async () => {
    pathname.mockReturnValue('/profile');
    let resolve!: (response: ReturnType<typeof notesReply>) => void;
    fetchNotes.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(notesReply([]));
    const view = render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    await waitFor(() => expect(fetchNotes).toHaveBeenCalledOnce());
    const signal = fetchNotes.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    expect(await screen.findByText('还没有笔记。')).toBeInTheDocument();
    await act(async () => resolve(notesReply([{ _id: 'old', title: '卸载后迟到记录' }])));
    expect(screen.queryByRole('link', { name: '卸载后迟到记录' })).not.toBeInTheDocument();
  });
  it('distinguishes loading, failure and a successful empty list, and lets a failure retry', async () => {
    pathname.mockReturnValue('/profile');
    let reject!: (error: Error) => void;
    fetchNotes.mockReturnValueOnce(new Promise((_, r) => { reject = r; })).mockResolvedValue(notesReply([]));
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    expect(await screen.findByText('正在加载最近笔记…')).toBeInTheDocument();
    await act(async () => reject(new Error('网络不可用')));
    expect(await screen.findByText('最近笔记加载失败。')).toBeInTheDocument();
    expect(screen.queryByText('还没有笔记。')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试最近笔记' }));
    expect(await screen.findByText('还没有笔记。')).toBeInTheDocument();
    expect(screen.queryByText('最近笔记加载失败。')).not.toBeInTheDocument();
  });
  it('uses an empty notes-page registration as authoritative when leaving notes', async () => {
    const notes: WorkspaceRecentNote[] = [];
    const view = render(<WorkspaceRoot><RecentNotesProbe notes={notes} /></WorkspaceRoot>);
    pathname.mockReturnValue('/profile'); view.rerender(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    expect(await screen.findByText('还没有笔记。')).toBeInTheDocument();
    expect(fetchNotes).not.toHaveBeenCalled();
  });
  it('does not refetch an accepted empty projection on settings or route changes', async () => {
    pathname.mockReturnValue('/profile');
    const view = render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    expect(await screen.findByText('还没有笔记。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开账户设置' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    pathname.mockReturnValue('/inspiration'); view.rerender(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    expect(fetchNotes).toHaveBeenCalledOnce();
  });
});

describe('工作区边界与外观', () => {
  it.each([
    { label: 'another account', persisted: { id: 'u2', username: '另一账户', email: 'other@example.com', createdAt: '2026-10-20' } },
    { label: 'a cleared identity', persisted: null },
  ])('ignores a delayed profile response when the persistent user becomes $label', async ({ persisted }) => {
    let resolve!: (user: Record<string, string>) => void;
    profileSave.mockReturnValue(new Promise<Record<string, string>>(r => { resolve = r; }));
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    fireEvent.click(screen.getByRole('button', { name: '打开账户设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: '账户A的新名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    // Shared storage can change in another tab without a local route/settings change.
    if (persisted) localStorage.setItem('user', JSON.stringify(persisted));
    else localStorage.removeItem('user');
    await act(async () => resolve({ id: 'u1', username: '账户A的迟到响应', email: 'test@example.com' }));
    expect(JSON.parse(localStorage.getItem('user') || 'null')).toEqual(persisted);
    expect(workspaceValue!.user).toEqual(persisted);
    expect(screen.getByRole('button', { name: '账户菜单' })).toHaveTextContent(persisted?.username || '我的账户');
    expect(screen.queryByText('账户A的迟到响应')).not.toBeInTheDocument();
  });
  it('publishes the accepted account data to the shared identity and current user cache', async () => {
    profileSave.mockResolvedValue({ id: 'u1', username: '服务端名字', email: 'test@example.com', avatar: 'preset:02' });
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    fireEvent.click(screen.getByRole('button', { name: '打开账户设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: '请求的名字' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑资料' })).not.toBeInTheDocument());
    expect(within(screen.getByRole('dialog', { name: '设置' })).getByText('服务端名字')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('user') || '{}')).toMatchObject({ id: 'u1', username: '服务端名字', avatar: 'preset:02' });
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    expect(screen.getByRole('button', { name: '账户菜单' })).toHaveTextContent('服务端名字');
    expect(screen.getByRole('button', { name: '账户菜单' }).querySelector('img')).toHaveAttribute('src', '/avatars/profile-preset-02.svg');
  });
  it('does not replace an open dirty account session through another workspace action', async () => {
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    fireEvent.click(screen.getByRole('button', { name: '打开账户设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: '未保存名字' } });
    act(() => workspaceValue!.openAccountDialog!('password'));
    expect(screen.getByRole('dialog', { name: '编辑资料' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '修改密码' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '用户名' })).toHaveValue('未保存名字');
  });
  it('uses the registered chat sidebar and new-session action without a second session owner', async () => {
    pathname.mockReturnValue('/chat'); render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    fireEvent.click(await screen.findByRole('button', { name: '一段真实历史' }));
    expect(selectChat).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByRole('button', { name: '开启新对话' }));
    expect(newChat).toHaveBeenCalledOnce();
    expect(screen.queryByText('在对话页面查看和查找历史。')).not.toBeInTheDocument();
  });
  it('opens a requested settings category with the server controller while retaining the draft', async () => {
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    fireEvent.click(screen.getByRole('button', { name: '打开灵感设置' }));
    expect(await screen.findByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '定期为我寻找灵感' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    expect(screen.getByRole('textbox', { name: '业务草稿' })).toHaveValue('保留它');
  });
  it('keeps settings beneath the shared account dialog and returns without clearing the page', async () => {
    render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    fireEvent.click(screen.getByRole('button', { name: '打开账户设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑资料' }));
    expect(await screen.findByRole('dialog', { name: '编辑资料' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑资料' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '业务草稿' })).toHaveValue('保留它');
  });
  it('keeps a newer chat registration when an old effect releases', async () => {
    pathname.mockReturnValue('/chat'); render(<WorkspaceRoot><WorkspaceProbe /></WorkspaceRoot>);
    let release!: () => void;
    act(() => { release = workspaceValue!.registerChatNavigation!({ ...chatNavigation, sessions: [] }); });
    act(() => { workspaceValue!.registerChatNavigation!(chatNavigation); release(); });
    expect(await screen.findByRole('button', { name: '一段真实历史' })).toBeInTheDocument();
  });
  it.each(['/auth', '/login', '/register', '/admin', '/admin/login', '/admin/users'])('%s 不加载工作区', (path) => {
    pathname.mockReturnValue(path);
    render(<WorkspaceRoot><div>原页面</div></WorkspaceRoot>);
    expect(screen.getByText('原页面')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(unread).not.toHaveBeenCalled();
  });

  it.each(['/notes', '/chat', '/inspiration', '/profile'])('%s 有统一工作区与可折叠导航', async (path) => {
    pathname.mockReturnValue(path);
    await act(async () => { render(<WorkspaceRoot><div>业务内容</div></WorkspaceRoot>); });
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI 对话' })).toHaveAttribute('href', '/chat');
  });

  it('设置覆盖业务而不清空输入，偏好仅作用工作区', async () => {
    render(<WorkspaceRoot><input aria-label="业务草稿" defaultValue="未保存的文字" /></WorkspaceRoot>);
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    fireEvent.click(screen.getByRole('button', { name: '大' }));
    const root = document.querySelector('[data-workspace]');
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(root).toHaveAttribute('data-reading-size', 'large');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(document.documentElement).not.toHaveClass('dark');
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    expect(screen.getByRole('textbox', { name: '业务草稿' })).toHaveValue('未保存的文字');
    await waitFor(() => expect(JSON.parse(localStorage.getItem('nwai.workspace.preferences.v1') || '{}').theme).toBe('dark'));
  });

  it('读取已保存主题，并以真实未读数更新徽标', async () => {
    localStorage.setItem('nwai.workspace.preferences.v1', JSON.stringify({ theme: 'dark' }));
    unread.mockResolvedValueOnce(2).mockResolvedValue(0);
    render(<WorkspaceRoot><div /></WorkspaceRoot>);
    await waitFor(() => expect(document.querySelector('[data-workspace]')).toHaveAttribute('data-theme', 'dark'));
    expect(await screen.findByLabelText('2 条新灵感')).toBeInTheDocument();
    window.dispatchEvent(new Event('inspiration-count-changed'));
    await waitFor(() => expect(screen.queryByLabelText('2 条新灵感')).not.toBeInTheDocument());
  });

  it('账户菜单 Escape 关闭后焦点回到入口', () => {
    render(<WorkspaceRoot><div /></WorkspaceRoot>);
    const trigger = screen.getByRole('button', { name: '账户菜单' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});

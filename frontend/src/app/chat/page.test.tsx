import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import ChatPage from './page';
import { WorkspaceContext, type WorkspaceContextValue } from '../../components/workspace/WorkspaceContext';
import type { IChat } from '../../types';

const { authFetch, router, searchParams } = vi.hoisted(() => ({
  authFetch: vi.fn(),
  searchParams: { value: '' },
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/chat',
  useSearchParams: () => new URLSearchParams(searchParams.value),
}));
vi.mock('../../utils/auth', () => ({
  authFetch,
  isAuthenticated: () => true,
  getUser: () => ({ id: 'user-1', username: '测试用户' }),
  logout: vi.fn(),
}));
vi.mock('../../services/inspirationService', () => ({
  getUnviewedInspirationCount: async () => 0,
}));

const history: IChat = {
  id: 'history-1',
  title: '上次的对话',
  messages: [{ role: 'user', content: '这是历史消息' }],
};

function sessionsResponse(sessions: IChat[]) {
  return { ok: true, json: async () => ({ success: true, data: { sessions } }) };
}

function committedResponse(session: IChat) {
  const stream = `data: ${JSON.stringify({ type: 'committed', session })}\n\ndata: [DONE]\n\n`;
  let delivered = false;
  return {
    ok: true,
    body: { getReader: () => ({
      read: async () => {
        if (delivered) return { done: true };
        delivered = true;
        return { done: false, value: new TextEncoder().encode(stream) };
      },
      cancel: async () => {},
      releaseLock: () => {},
    }) },
  };
}

async function loadServerHistory() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
}

function expectNewConversation() {
  expect(screen.getByText('今天，想从哪里聊起？')).toBeInTheDocument();
  expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '上次的对话' })).not.toHaveAttribute('aria-current');
}

describe('chat page entry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    searchParams.value = '';
    router.replace.mockImplementation((href: string) => { searchParams.value = new URL(href, 'http://localhost').search.slice(1); });
    localStorage.clear();
    sessionStorage.clear();
    authFetch.mockResolvedValue(sessionsResponse([history]));
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true, value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('registers current real history with the workspace without rendering a second history column', async () => {
    const registerChatNavigation = vi.fn((_value: unknown) => vi.fn());
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    const workspace = { registerChatNavigation } as unknown as WorkspaceContextValue;
    render(<WorkspaceContext.Provider value={workspace}><ChatPage /></WorkspaceContext.Provider>);
    expect(screen.queryByRole('complementary', { name: '聊天历史' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(registerChatNavigation.mock.calls.at(-1)?.[0]).toMatchObject({ sessions: [history], currentSessionId: '' });
  });

  it('loads the real session requested by the URL, including an empty note binding', async () => {
    searchParams.value = 'session=note-bound';
    authFetch.mockResolvedValue(sessionsResponse([{ id: 'note-bound', title: '选中的笔记', sourceNoteId: 'note-1', messages: [] }, history]));
    render(<ChatPage />);
    await loadServerHistory();
    expect(screen.getByRole('region', { name: '正在讨论' })).toHaveTextContent('选中的笔记');
    expect(screen.getByText('围绕这篇笔记提问')).toBeInTheDocument();
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    expect(authFetch.mock.calls.some(([url]) => url === '/api/chat/robot/intro')).toBe(false);
  });

  it('shows an invalid explicit session without opening a different history', async () => {
    searchParams.value = 'session=missing';
    render(<ChatPage />);
    await loadServerHistory();
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开这段对话');
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
  });

  it('restores B, its draft and its position after selecting it from URL A and visiting its source (F1)', async () => {
    searchParams.value = 'session=history-1';
    const source = { noteId: 'source-b', title: 'B的来源', content: 'B的原文' };
    const other: IChat = { id: 'history-2', title: '对话B', messages: [{ role: 'user', content: 'B的历史' }], relatedNotes: [source] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history, other]));
    authFetch.mockResolvedValue(sessionsResponse([history, other]));
    const page = render(<ChatPage />);
    await loadServerHistory();
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '对话B' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B的草稿' } });
    (screen.getByRole('main').firstElementChild as HTMLElement).scrollTop = 286;
    fireEvent.click(screen.getByRole('button', { name: /B的来源/ }));
    page.unmount();

    render(<ChatPage />);
    await loadServerHistory();
    expect(screen.getByRole('button', { name: '对话B' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('B的历史')).toBeInTheDocument();
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('B的草稿');
    expect((screen.getByRole('main').firstElementChild as HTMLElement).scrollTop).toBe(286);
  });

  it('deleting explicit A restores automatic B with draft and scroll after its source round trip (final F2)', async () => {
    searchParams.value = 'session=history-1';
    const other: IChat = { id: 'history-2', title: '对话B', sourceNoteId: 'source-b', messages: [{ role: 'user', content: 'B的历史' }], relatedNotes: [{ noteId: 'source-b', title: 'B的来源', content: 'B的原文' }] };
    let serverSessions = [history, other];
    authFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE') { serverSessions = [other]; return { ok: true }; }
      return sessionsResponse(serverSessions);
    });
    const page = render(<ChatPage />);
    await loadServerHistory();
    fireEvent.click(screen.getByRole('button', { name: '删除对话：上次的对话' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(screen.getByRole('button', { name: '对话B' })).toHaveAttribute('aria-current', 'page');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '删除A后B的草稿' } });
    (screen.getByRole('main').firstElementChild as HTMLElement).scrollTop = 312;
    fireEvent.click(within(screen.getByRole('region', { name: '正在讨论' })).getByRole('link', { name: /B的来源/ }));
    page.unmount();
    render(<ChatPage />);
    await loadServerHistory();
    expect(screen.getByRole('textbox')).toHaveValue('删除A后B的草稿');
    expect(screen.getByText('B的历史')).toBeInTheDocument();
    expect((screen.getByRole('main').firstElementChild as HTMLElement).scrollTop).toBe(312);
    expect(searchParams.value).toBe('');
  });

  it('successful deletion of another history preserves the active explicit URL (final F2)', async () => {
    searchParams.value = 'session=history-1';
    const other: IChat = { id: 'history-2', title: '对话B', messages: [{ role: 'user', content: 'B的历史' }] };
    authFetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'DELETE' ? { ok: true } : sessionsResponse([history, other]));
    render(<ChatPage />);
    await loadServerHistory();
    fireEvent.click(screen.getByRole('button', { name: '删除对话：对话B' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(screen.queryByRole('button', { name: '对话B' })).not.toBeInTheDocument();
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    expect(searchParams.value).toBe('session=history-1');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('retains explicit URL on failed delete, then clears it when deleting the last session and can send fresh (final F2)', async () => {
    searchParams.value = 'session=history-1';
    let failDelete = true;
    authFetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'DELETE' ? { ok: !failDelete, json: async () => ({ message: '删除失败' }) } : sessionsResponse([history]));
    render(<ChatPage />);
    await loadServerHistory();
    fireEvent.click(screen.getByRole('button', { name: '删除对话：上次的对话' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(searchParams.value).toBe('session=history-1');
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    failDelete = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(searchParams.value).toBe('');
    expect(screen.getByText('今天，想从哪里聊起？')).toBeInTheDocument();
    authFetch.mockResolvedValueOnce(committedResponse({ id: 'new-after-delete', title: '新对话', messages: [{ role: 'user', content: '新的问题' }, { role: 'assistant', content: '删除后新回答' }] }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新的问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    expect(screen.getByText('删除后新回答')).toBeInTheDocument();
    const request = authFetch.mock.calls.find(([url]) => url === '/api/chat');
    expect(JSON.parse(request![1].body).sessionId).toBeUndefined();
  });

  it('validates a cached explicit session against the loaded server history and blocks sending when stale (F2)', async () => {
    searchParams.value = 'session=history-1';
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    authFetch.mockResolvedValue(sessionsResponse([]));
    render(<ChatPage />);
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    await loadServerHistory();
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开这段对话');
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '失效来源下的问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    expect(authFetch.mock.calls.filter(([url]) => url === '/api/chat')).toHaveLength(0);
    expect(screen.getByRole('textbox')).toHaveValue('失效来源下的问题');
  });

  it('isolates an invalid URL change from the previously selected A until deliberate selection (F3)', async () => {
    searchParams.value = 'session=history-1';
    const page = render(<ChatPage />);
    await loadServerHistory();
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    searchParams.value = 'session=missing-b';
    page.rerender(<ChatPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开这段对话');
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上次的对话' })).not.toHaveAttribute('aria-current');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '只给B的问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    expect(authFetch.mock.calls.filter(([url]) => url === '/api/chat')).toHaveLength(0);
    expect(screen.getByRole('textbox')).toHaveValue('只给B的问题');

    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    authFetch.mockResolvedValueOnce(committedResponse({ ...history, messages: [...history.messages, { role: 'user', content: '只给B的问题' }, { role: 'assistant', content: '选择A后的回答' }] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    const request = authFetch.mock.calls.find(([url]) => url === '/api/chat');
    expect(JSON.parse(request![1].body).sessionId).toBe('history-1');
    expect(screen.getByText('选择A后的回答')).toBeInTheDocument();

    // Browser history may revisit the same failed URL after a deliberate choice.
    searchParams.value = 'session=missing-b';
    page.rerender(<ChatPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开这段对话');
    expect(screen.queryByText('选择A后的回答')).not.toBeInTheDocument();
  });

  it('leaves the failed entry state when missing changes to plain /chat and sends a new conversation (F4)', async () => {
    searchParams.value = 'session=history-1';
    const page = render(<ChatPage />);
    await loadServerHistory();
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    searchParams.value = 'session=missing';
    page.rerender(<ChatPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开这段对话');

    searchParams.value = '';
    page.rerender(<ChatPage />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上次的对话' })).not.toHaveAttribute('aria-current');
    authFetch.mockImplementation(async (url: string) => url === '/api/chat'
      ? committedResponse({ id: 'plain-new', title: '新的普通对话', messages: [{ role: 'user', content: '普通入口的新问题' }, { role: 'assistant', content: '全新回答' }] })
      : sessionsResponse([history]));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '普通入口的新问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    const requests = authFetch.mock.calls.filter(([url]) => url === '/api/chat');
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0][1].body)).toEqual({ messages: [{ role: 'user', content: '普通入口的新问题' }] });
    expect(screen.getByText('全新回答')).toBeInTheDocument();
  });

  it('projects waiting and failure onto the request conversation after switching to B', async () => {
    let finish!: (response: unknown) => void;
    const other = { ...history, id: 'history-2', title: '对话B', messages: [{ role: 'user' as const, content: 'B的历史' }] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history, other]));
    authFetch.mockImplementation((url: string) => url === '/api/chat' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(sessionsResponse([history, other])));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A的新问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    fireEvent.click(screen.getByRole('button', { name: '对话B' }));
    expect(screen.getByRole('textbox')).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('另一段对话正在回复');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B的未发送草稿' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    expect(authFetch.mock.calls.filter(([url]) => url === '/api/chat')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('B的未发送草稿');
    await act(async () => { finish({ ok: false, json: async () => ({ error: '来源笔记已删除' }) }); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('B的历史')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    expect(screen.getByRole('alert')).toHaveTextContent('来源笔记已删除');
    expect(screen.getByText('A的新问题')).toBeInTheDocument();
  });

  it('retains real history and confirmation after a failed deletion, then retries', async () => {
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    authFetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'DELETE' ? { ok: false, json: async () => ({}) } : sessionsResponse([history]));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '删除对话：上次的对话' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('删除失败');
    expect(screen.getByRole('button', { name: '上次的对话' })).toBeInTheDocument();
    authFetch.mockResolvedValue({ ok: true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '上次的对话' })).not.toBeInTheDocument();
  });

  it('restricts deletion by the active request identity after switching conversations', async () => {
    let finishReply!: (response: unknown) => void;
    let finishDelete!: (response: unknown) => void;
    const other = { ...history, id: 'history-2', title: '对话B', messages: [{ role: 'user' as const, content: 'B的历史' }] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history, other]));
    authFetch.mockImplementation((url: string, options?: RequestInit) => url === '/api/chat'
      ? new Promise(resolve => { finishReply = resolve; })
      : options?.method === 'DELETE' ? new Promise(resolve => { finishDelete = resolve; }) : Promise.resolve(sessionsResponse([history, other])));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A的问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    fireEvent.click(screen.getByRole('button', { name: '对话B' }));
    fireEvent.click(screen.getByRole('button', { name: '删除对话：上次的对话' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('AI 正在回复');
    expect(authFetch.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '删除对话：对话B' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled();
    expect(screen.getByText('B的历史')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对话B' })).toBeInTheDocument();
    expect(authFetch.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
    await act(async () => { finishDelete({ ok: true }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '对话B' })).not.toBeInTheDocument();
    await act(async () => { finishReply(committedResponse({ ...history, messages: [{ role: 'user', content: 'A的问题' }, { role: 'assistant', content: 'A的回答' }] })); });
    expect(screen.getByText('A的回答')).toBeInTheDocument();
  });

  it('keeps workspace registration stable while only the draft or context container changes', () => {
    const registerChatNavigation = vi.fn((_value: unknown) => vi.fn());
    const workspace = { registerChatNavigation } as unknown as WorkspaceContextValue;
    const page = render(<WorkspaceContext.Provider value={workspace}><ChatPage /></WorkspaceContext.Provider>);
    const registered = registerChatNavigation.mock.calls.length;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '尚未发送' } });
    page.rerender(<WorkspaceContext.Provider value={{ ...workspace }}><ChatPage /></WorkspaceContext.Provider>);
    expect(registerChatNavigation).toHaveBeenCalledTimes(registered);
  });

  it('opens a new conversation when cached history is available', () => {
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    render(<ChatPage />);

    expectNewConversation();
    // Entering the page must not persist another empty conversation.
    expect(JSON.parse(localStorage.getItem('chat_sessions_user-1')!)).toEqual([history]);
  });

  it('binds the care entry to its selected note and uses server snapshots for the first answer', async () => {
    const snapshot = { noteId: 'note-1', title: '学习安排', contentText: '周三20分钟；周日25分钟。', revision: 4, updatedAt: '2026-10-18T01:00:00.000Z', hasImages: false };
    authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/chat/robot/intro') return { ok: true, json: async () => ({ data: { noteId: 'note-1', noteTitle: '学习安排', snippet: '周三20分钟', aiOpening: '聊聊学习安排。' } }) };
      if (url === '/api/chat/save') return { ok: true, json: async () => ({ data: { sessionId: 'care-1' } }) };
      if (url === '/api/chat') return committedResponse({
        id: 'care-1', title: '学习安排', sourceNoteId: 'note-1',
        messages: [{ role: 'assistant', content: '聊聊学习安排。' }, { role: 'user', content: '下周怎么安排？' }, { role: 'assistant', content: '从周三20分钟开始。', sourceSnapshot: snapshot }],
      });
      return sessionsResponse([]);
    });
    render(<ChatPage />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '从这条笔记聊起' })); });

    const selection = screen.getByRole('region', { name: '正在讨论' });
    expect(screen.getByRole('region', { name: '笔记原文' })).toHaveTextContent('学习安排');
    expect(selection).toHaveTextContent('从一条笔记聊起');
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveAttribute('placeholder', '接着聊聊你的想法，也可以问点别的…');
    expect(screen.queryByRole('region', { name: '相关笔记' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /相关笔记/ })).not.toBeInTheDocument();
    expect(screen.queryByText('本次回答依据')).not.toBeInTheDocument();
    expect(JSON.parse(authFetch.mock.calls.find(([url]) => url === '/api/chat/save')![1].body).sourceNoteId).toBe('note-1');
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), { target: { value: '下周怎么安排？' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });

    expect(screen.getByText('本次回答依据')).toBeInTheDocument();
    expect(screen.getByText('周三20分钟；周日25分钟。')).toBeInTheDocument();
    // Committed history no longer contains message-level care metadata.
    // Keep the opening identity without using a later answer's snapshot as its excerpt.
    expect(screen.queryByRole('region', { name: 'AI 开场提问' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '笔记原文' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '正在讨论' })).toHaveTextContent('学习安排');
    expect(screen.getByRole('region', { name: '正在讨论' })).not.toHaveTextContent('从一条笔记聊起');
    expect(JSON.parse(authFetch.mock.calls.find(([url]) => url === '/api/chat')![1].body)).toMatchObject({ sessionId: 'care-1', sourceNoteId: 'note-1' });
    expect(JSON.parse(localStorage.getItem('chat_sessions_user-1')!).find((session: IChat) => session.id === 'care-1').messages.at(-1).sourceSnapshot).toEqual(snapshot);
  });

  it('keeps only other notes in the bound conversation sidebar and drawer, with matching counts', () => {
    const sourceNote = { noteId: 'source-1', title: '正在讨论的安排', content: '每周学习20分钟。', matchType: 'care_source' };
    const otherNote = { noteId: 'other-1', title: '另一条学习线索', content: '周末复盘。', score: 0.9 };
    const bound: IChat = {
      id: 'bound-1', title: '已绑定的对话', sourceNoteId: sourceNote.noteId,
      messages: [{ role: 'assistant', content: '你想从哪里开始？', relatedNotes: [sourceNote] }],
      relatedNotes: [sourceNote, otherNote],
    };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([bound]));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '已绑定的对话' }));

    expect(screen.getByRole('region', { name: '笔记原文' })).toHaveTextContent(sourceNote.title);
    const sidebar = screen.getByRole('region', { name: '相关笔记' });
    expect(within(sidebar).queryByRole('button', { name: new RegExp(sourceNote.title) })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: new RegExp(otherNote.title) })).toBeInTheDocument();
    expect(within(sidebar).getByRole('heading', { name: /相关笔记\s*1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /相关笔记\s*1/ }));
    const drawer = screen.getByRole('dialog', { name: '相关笔记' });
    expect(within(drawer).queryByRole('button', { name: new RegExp(sourceNote.title) })).not.toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: /相关笔记\s*1/ })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: new RegExp(otherNote.title) }));
    expect(router.push).toHaveBeenCalledWith('/notes?highlight=other-1');
  });

  it('resets the bound opener when starting an ordinary new conversation', async () => {
    const sourceNote = { noteId: 'source-1', title: '学习安排', content: '每周学习20分钟。', matchType: 'care_source' };
    const bound: IChat = {
      id: 'bound-1', title: '已绑定的对话', sourceNoteId: sourceNote.noteId,
      messages: [{ role: 'assistant', content: '你想从哪里开始？', relatedNotes: [sourceNote] }],
      relatedNotes: [sourceNote],
    };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([bound]));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '已绑定的对话' }));
    expect(screen.getByRole('region', { name: '正在讨论' })).toHaveTextContent('从一条笔记聊起');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开启新对话' })); });

    expect(screen.getByText('今天，想从哪里聊起？')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '正在讨论' })).not.toBeInTheDocument();
    expect(screen.queryByText('你想从哪里开始？')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '相关笔记' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveAttribute('placeholder', '输入您的问题...');
    const sessions = JSON.parse(localStorage.getItem('chat_sessions_user-1')!) as IChat[];
    expect(sessions.find(session => session.messages.length === 0)).not.toHaveProperty('sourceNoteId');
    expect(sessions.find(session => session.id === bound.id)?.sourceNoteId).toBe(sourceNote.noteId);
  });

  it('shows a rejected care save without presenting a successfully selected source', async () => {
    authFetch.mockImplementation(async (url: string) => url === '/api/chat/robot/intro'
      ? { ok: true, json: async () => ({ data: { noteId: 'deleted-1', noteTitle: '已删除的安排', snippet: '旧片段', aiOpening: '聊聊旧安排。' } }) }
      : { ok: false, json: async () => ({ message: '来源笔记已删除，请选择其他笔记' }) });
    render(<ChatPage />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '从这条笔记聊起' })); });

    expect(screen.getByRole('alert')).toHaveTextContent('来源笔记已删除');
    expect(screen.queryByRole('region', { name: '正在讨论' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '从这条笔记聊起' })).toBeInTheDocument();
  });

  it('clears the submitted question as soon as the stream is accepted', async () => {
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    let resolveChatRequest!: (response: { ok: boolean; body: null }) => void;
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/chat') return new Promise(resolve => { resolveChatRequest = resolve; });
      return Promise.resolve(sessionsResponse([history]));
    });
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    const composer = screen.getByRole('textbox', { name: '聊天消息' });
    fireEvent.change(composer, { target: { value: '先把这个问题发出去' } });

    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });

      expect(composer).toHaveValue('');
      expect(screen.getByRole('textbox', { name: '聊天消息' })).toBeDisabled();
    } finally {
      await act(async () => { resolveChatRequest({ ok: true, body: null }); });
    }
  });

  it('does not clear a later draft when the accepted question eventually commits', async () => {
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    let resolveChatRequest!: (response: ReturnType<typeof committedResponse>) => void;
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/chat') return new Promise(resolve => { resolveChatRequest = resolve; });
      return Promise.resolve(sessionsResponse([history]));
    });
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    const composer = screen.getByRole('textbox', { name: '聊天消息' });
    fireEvent.change(composer, { target: { value: '先发出的问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });

    fireEvent.change(composer, { target: { value: '后来写下的草稿' } });
    try {
      await act(async () => {
        resolveChatRequest(committedResponse({
          ...history,
          messages: [...history.messages, { role: 'user', content: '先发出的问题' }, { role: 'assistant', content: '回答' }],
        }));
        await Promise.resolve();
      });

      expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('后来写下的草稿');
    } finally {
      if (resolveChatRequest) await act(async () => { resolveChatRequest(committedResponse(history)); });
    }
  });

  it('does not replace a later draft with the failed question when the request fails', async () => {
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    let resolveChatRequest!: (response: { ok: false; json: () => Promise<{ message: string }> }) => void;
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/chat') return new Promise(resolve => { resolveChatRequest = resolve; });
      return Promise.resolve(sessionsResponse([history]));
    });
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    const composer = screen.getByRole('textbox', { name: '聊天消息' });
    fireEvent.change(composer, { target: { value: '需要重试的问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });

    fireEvent.change(composer, { target: { value: '后来写下的草稿' } });
    await act(async () => {
      resolveChatRequest({ ok: false, json: async () => ({ message: 'AI 服务暂不可用' }) });
      await Promise.resolve();
    });

    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('后来写下的草稿');
    expect(screen.getByRole('alert')).toHaveTextContent('AI 服务暂不可用');
  });

  it('does not restore the failed question after the user switches conversations', async () => {
    const otherHistory: IChat = { id: 'history-2', title: '另一个话题', messages: [{ role: 'user', content: '另一个会话' }] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history, otherHistory]));
    let resolveChatRequest!: (response: { ok: false; json: () => Promise<{ message: string }> }) => void;
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/chat') return new Promise(resolve => { resolveChatRequest = resolve; });
      return Promise.resolve(sessionsResponse([history, otherHistory]));
    });
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), { target: { value: '只属于旧会话的问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });

    fireEvent.click(screen.getByRole('button', { name: '另一个话题' }));
    await act(async () => {
      resolveChatRequest({ ok: false, json: async () => ({ message: 'AI 服务暂不可用' }) });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '另一个话题' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('');
  });

  it('restores a bound historical source and retains the question when that source cannot be read', async () => {
    const bound: IChat = { ...history, sourceNoteId: 'note-1', relatedNotes: [{ noteId: 'note-1', title: '学习安排' }] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([bound]));
    authFetch.mockImplementation(async (url: string) => url === '/api/chat'
      ? { ok: false, status: 404, json: async () => ({ message: '来源笔记无法读取，请检查权限' }) }
      : sessionsResponse([bound]));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    expect(screen.getByRole('region', { name: '正在讨论' })).toHaveTextContent('学习安排');
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), { target: { value: '保留这个问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });

    expect(screen.getByRole('alert')).toHaveTextContent('检查权限');
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('保留这个问题');
    const saved = JSON.parse(localStorage.getItem('chat_sessions_user-1')!)[0] as IChat;
    expect(saved.messages.at(-1)).toEqual({ role: 'user', content: '保留这个问题' });
    expect(screen.queryByText('本次回答依据')).not.toBeInTheDocument();
  });

  it('stays in a new conversation when server history arrives later', async () => {
    render(<ChatPage />);
    await loadServerHistory();

    expectNewConversation();
  });

  it('returns to a new conversation after leaving a selected historical conversation', async () => {
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    const page = render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();

    page.unmount();
    render(<ChatPage />);
    await loadServerHistory();

    expectNewConversation();
  });

  it.each(['sidebar', 'message', 'drawer', 'explicit-url'] as const)('restores the same conversation, draft, and reading position after opening a %s source', async (source) => {
    if (source === 'explicit-url') searchParams.value = 'session=history-1';
    const sourceNote = { noteId: 'source-1', title: '学习时间限制', content: '周三只能学习20分钟。', score: 1 };
    const sourcedHistory: IChat = {
      ...history,
      messages: [...history.messages, { role: 'assistant', content: '这是相关的讨论', relatedNotes: [sourceNote] }],
      relatedNotes: [sourceNote],
    };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([sourcedHistory]));
    const page = render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    const scroller = screen.getByRole('main').firstElementChild as HTMLElement;
    scroller.scrollTop = 240;
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), { target: { value: '这个限制下该怎么安排？' } });
    if (source === 'drawer') fireEvent.click(screen.getByRole('button', { name: /相关笔记/ }));
    fireEvent.click(source === 'message'
      ? screen.getByRole('link', { name: /学习时间限制/ })
      : screen.getAllByRole('button', { name: /学习时间限制/ }).at(-1)!);
    page.unmount();

    render(<ChatPage />);
    await loadServerHistory();

    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上次的对话' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('这个限制下该怎么安排？');
    expect((screen.getByRole('main').firstElementChild as HTMLElement).scrollTop).toBe(240);
  });

  it('waits for uncached history before restoring the source conversation', async () => {
    const sourceNote = { noteId: 'source-1', title: '学习时间限制', content: '周三只能学习20分钟。', score: 1 };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([{ ...history, relatedNotes: [sourceNote] }]));
    const page = render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    fireEvent.click(screen.getByRole('button', { name: /学习时间限制/ }));
    page.unmount();
    localStorage.clear();

    render(<ChatPage />);
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    await loadServerHistory();

    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上次的对话' })).toHaveAttribute('aria-current', 'page');
  });

  it('preserves the restored reading position when the server adds messages missing from cache', async () => {
    const sourceNote = { noteId: 'source-1', title: '学习时间限制', content: '周三只能学习20分钟。', score: 1 };
    const cachedHistory = { ...history, relatedNotes: [sourceNote] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([cachedHistory]));
    const page = render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    (screen.getByRole('main').firstElementChild as HTMLElement).scrollTop = 240;
    fireEvent.click(screen.getByRole('button', { name: /学习时间限制/ }));
    page.unmount();
    authFetch.mockResolvedValue(sessionsResponse([{ ...cachedHistory, messages: [...history.messages, { role: 'assistant', content: '服务端补载的回答' }] }]));
    // jsdom has no layout; model the observable effect of scrolling the end anchor into view.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: function(this: HTMLElement) {
        const scroller = this.closest('main')?.firstElementChild as HTMLElement | undefined;
        if (scroller) scroller.scrollTop = 10000;
      },
    });

    render(<ChatPage />);
    await loadServerHistory();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(screen.getByText('服务端补载的回答')).toBeInTheDocument();
    expect((screen.getByRole('main').firstElementChild as HTMLElement).scrollTop).toBe(240);
  });

  it('keeps an explicit new conversation after returning from a source', async () => {
    const sourceNote = { noteId: 'source-1', title: '学习时间限制', content: '周三只能学习20分钟。', score: 1 };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([{ ...history, relatedNotes: [sourceNote] }]));
    const page = render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    fireEvent.click(screen.getByRole('button', { name: /学习时间限制/ }));
    page.unmount();
    const returnedPage = render(<ChatPage />);
    await loadServerHistory();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开启新对话' })); });
    returnedPage.unmount();

    render(<ChatPage />);
    await loadServerHistory();
    expectNewConversation();
  });

  it('restores a source visit with development strict effects enabled', async () => {
    const sourceNote = { noteId: 'source-1', title: '学习时间限制', content: '周三只能学习20分钟。', score: 1 };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([{ ...history, relatedNotes: [sourceNote] }]));
    const page = render(<StrictMode><ChatPage /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    fireEvent.click(screen.getByRole('button', { name: /学习时间限制/ }));
    page.unmount();

    render(<StrictMode><ChatPage /></StrictMode>);
    await loadServerHistory();
    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
  });

  it('does not replace a deliberate selection while the source history is still loading', async () => {
    const sourceNote = { noteId: 'source-1', title: '学习时间限制', content: '周三只能学习20分钟。', score: 1 };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([{ ...history, relatedNotes: [sourceNote] }]));
    const page = render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    fireEvent.click(screen.getByRole('button', { name: /学习时间限制/ }));
    page.unmount();
    const otherHistory: IChat = { id: 'history-2', title: '另一个话题', messages: [{ role: 'user', content: '我选择了另一个话题' }] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([otherHistory]));
    authFetch.mockResolvedValue(sessionsResponse([history, otherHistory]));

    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '另一个话题' }));
    await loadServerHistory();

    expect(screen.getByText('我选择了另一个话题')).toBeInTheDocument();
    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
  });

  it('keeps a deliberately selected history conversation when history refreshes', async () => {
    const otherHistory = { ...history, id: 'history-2', title: '另一个话题', messages: [] };
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    authFetch.mockResolvedValue(sessionsResponse([otherHistory, history]));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    await loadServerHistory();

    expect(screen.getByText('这是历史消息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上次的对话' })).toHaveAttribute('aria-current', 'page');
  });

  it('starts a new conversation from history without losing it to a refresh', async () => {
    localStorage.setItem('chat_sessions_user-1', JSON.stringify([history]));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '开启新对话' }));
    });
    await loadServerHistory();

    expectNewConversation();
  });

  it('keeps the first sent message in its new conversation after server commit', async () => {
    render(<ChatPage />);
    await loadServerHistory();
    const committed: IChat = {
      id: 'new-server-id', title: '今天的新话题',
      messages: [
        { role: 'user', content: '今天的新问题' },
        { role: 'assistant', content: '新问题的回答' },
      ],
    };
    authFetch.mockResolvedValueOnce(committedResponse(committed));
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), {
      target: { value: '今天的新问题' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    });

    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    expect(screen.getByText('今天的新问题')).toBeInTheDocument();
    expect(screen.getByText('新问题的回答')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今天的新话题' })).toHaveAttribute('aria-current', 'page');
    const request = authFetch.mock.calls.find(([url]) => url === '/api/chat');
    expect(JSON.parse(request![1].body)).toEqual({
      messages: [{ role: 'user', content: '今天的新问题' }],
    });
  });

  it.each([
    { selection: 'the new conversation', selectHistory: false },
    { selection: 'a deliberately selected historical conversation', selectHistory: true },
  ])('keeps $selection selected when history arrives during the first reply', async ({ selectHistory }) => {
    let finishReply!: (response: ReturnType<typeof committedResponse>) => void;
    authFetch.mockImplementation((url: string) => url === '/api/chat'
      ? new Promise((resolve) => { finishReply = resolve; })
      : Promise.resolve(sessionsResponse([history])));
    render(<ChatPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), {
      target: { value: '今天的新问题' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    });
    await loadServerHistory();
    if (selectHistory) {
      fireEvent.click(screen.getByRole('button', { name: '上次的对话' }));
    }
    await act(async () => {
      finishReply(committedResponse({
        id: 'new-server-id', title: '今天的新话题',
        messages: [
          { role: 'user', content: '今天的新问题' },
          { role: 'assistant', content: '新问题的回答' },
        ],
      }));
    });

    if (selectHistory) {
      expect(screen.getByText('这是历史消息')).toBeInTheDocument();
      expect(screen.queryByText('新问题的回答')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '上次的对话' })).toHaveAttribute('aria-current', 'page');
    } else {
      expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
      expect(screen.getByText('新问题的回答')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '今天的新话题' })).toHaveAttribute('aria-current', 'page');
    }
  });

  it('clears a failed note opening error when an ordinary turn succeeds', async () => {
    authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/chat/robot/intro') return { ok: true, json: async () => ({ data: { noteId: 'deleted-1', noteTitle: '已删除的安排', snippet: '旧片段', aiOpening: '聊聊旧安排。' } }) };
      if (url === '/api/chat/save') return { ok: false, json: async () => ({ message: '来源笔记已删除，请选择其他笔记' }) };
      if (url === '/api/chat') return committedResponse({ id: 'ordinary-success', title: '普通成功对话', messages: [{ role: 'user', content: '普通问题' }, { role: 'assistant', content: '普通回答已成功保存' }] });
      return sessionsResponse([]);
    });
    render(<ChatPage />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '从这条笔记聊起' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('来源笔记已删除');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '普通问题' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    expect(screen.getByText('普通回答已成功保存')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries a failed explicit history read without losing the draft and sends to its confirmed binding', async () => {
    searchParams.value = 'session=newly-saved';
    authFetch.mockResolvedValue({ ok: false, json: async () => ({ message: '暂时不可用' }) });
    render(<ChatPage />);
    await loadServerHistory();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留的问题' } });
    expect(screen.getByRole('alert')).toHaveTextContent('对话历史');
    const bound: IChat = { id: 'newly-saved', title: '新笔记讨论', sourceNoteId: 'note-1', messages: [] };
    let finishRetry!: (response: ReturnType<typeof sessionsResponse>) => void;
    authFetch.mockImplementation((url: string) => url === '/api/chat/sessions'
      ? new Promise(resolve => { finishRetry = resolve; })
      : Promise.resolve(committedResponse({ ...bound, messages: [{ role: 'user', content: '保留的问题' }, { role: 'assistant', content: '绑定问题已回答' }] })));
    fireEvent.click(screen.getByRole('button', { name: '重试加载对话' }));
    expect(screen.getByRole('button', { name: '正在重试…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '正在重试…' }));
    expect(authFetch.mock.calls.filter(([url]) => url === '/api/chat/sessions')).toHaveLength(2);
    expect(screen.getByRole('textbox')).toHaveValue('保留的问题');
    await act(async () => { finishRetry(sessionsResponse([bound])); });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    expect(screen.getByText('绑定问题已回答')).toBeInTheDocument();
    const request = authFetch.mock.calls.find(([url]) => url === '/api/chat');
    expect(JSON.parse(request![1].body)).toMatchObject({ sessionId: 'newly-saved', sourceNoteId: 'note-1' });
  });

  it('keeps a draft after repeated history failure, then treats a successful missing record as invalid', async () => {
    searchParams.value = 'session=missing';
    authFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'offline' }) });
    render(<ChatPage />);
    await loadServerHistory();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '等待恢复的草稿' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试加载对话' })); });
    expect(screen.getByRole('textbox')).toHaveValue('等待恢复的草稿');
    expect(screen.getByRole('button', { name: '重试加载对话' })).toBeEnabled();
    authFetch.mockResolvedValue(sessionsResponse([]));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试加载对话' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开这段对话');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
    expect(authFetch.mock.calls.some(([url]) => url === '/api/chat')).toBe(false);
    expect(screen.getByRole('textbox')).toHaveValue('等待恢复的草稿');
  });

  it('preserves a new committed conversation when an earlier history request resolves last', async () => {
    let finishHistory!: (response: ReturnType<typeof sessionsResponse>) => void;
    authFetch.mockImplementation((url: string) => url === '/api/chat/sessions'
      ? new Promise((resolve) => { finishHistory = resolve; })
      : Promise.resolve(committedResponse({
        id: 'new-server-id', title: '今天的新话题',
        messages: [
          { role: 'user', content: '今天的新问题' },
          { role: 'assistant', content: '新问题的回答' },
        ],
      })));
    render(<ChatPage />);
    await loadServerHistory();
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), {
      target: { value: '今天的新问题' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    });
    await act(async () => { finishHistory(sessionsResponse([history])); });

    expect(screen.queryByText('这是历史消息')).not.toBeInTheDocument();
    expect(screen.getByText('新问题的回答')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今天的新话题' })).toHaveAttribute('aria-current', 'page');
    expect(JSON.parse(localStorage.getItem('chat_sessions_user-1')!).map((session: IChat) => session.id))
      .toContain('new-server-id');
  });
});

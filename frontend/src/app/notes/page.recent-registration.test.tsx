/*
Input: 真实 NotesPage/useNotes/WorkspaceRoot 与受控笔记服务响应
Output: 未加载/失败不发布空权威投影，确认空库不重读，已有投影保持
Pos: notes 最近记录跨页回归；修改时同步 README。
*/
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotesPage from './page';
import WorkspaceRoot from '../../components/workspace/WorkspaceRoot';

const mocks = vi.hoisted(() => ({ pathname: '/notes', fetch: vi.fn(), router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => mocks.router }));
vi.mock('../../utils/auth', () => ({ getUser: () => ({ id: 'recent-user', username: '最近笔记用户' }), isAuthenticated: () => true, authFetch: mocks.fetch, logout: vi.fn() }));
vi.mock('../../services/inspirationService', () => ({ getUnviewedInspirationCount: async () => 0 }));
vi.mock('../../hooks/useInspirationSettings', () => ({ useInspirationSettings: () => ({ settings: null, loading: false, saving: false, error: null, refetch: vi.fn(), setEnabled: vi.fn() }) }));

const note = { _id: 'real-note', title: '真实服务笔记', content: '正文', contentText: '正文', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', revision: 1 };
const reply = (notes = [note]) => ({ ok: true, json: async () => ({ success: true, data: { notes, pageInfo: { hasMore: true, nextCursor: 'older-notes' } } }) });
function deferred() {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ReturnType<typeof reply>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(path = '/notes') {
  mocks.pathname = path;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  const tree = () => <QueryClientProvider client={client}><WorkspaceRoot>{mocks.pathname === '/notes' ? <NotesPage /> : <main>其他工作区页面</main>}</WorkspaceRoot></QueryClientProvider>;
  const view = render(tree());
  return { client, go: (path: string) => { mocks.pathname = path; view.rerender(tree()); } };
}
const recent = () => within(screen.getByRole('region', { name: '最近笔记' }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('真实笔记页登记最近记录', () => {
  it('首屏 GET 未完成就离开时，由非笔记页读取真实最近记录', async () => {
    const first = deferred();
    mocks.fetch.mockReturnValueOnce(first.promise).mockResolvedValue(reply());
    const page = setup();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText('正在加载笔记…')).toBeInTheDocument();
    page.go('/profile');
    expect(await recent().findByRole('link', { name: '真实服务笔记' })).toHaveAttribute('href', '/notes?highlight=real-note');
    expect(page.client.getQueryData(['notes'])).toBeUndefined();
    await act(async () => first.resolve(reply([])));
    expect(recent().getByRole('link', { name: '真实服务笔记' })).toBeInTheDocument();
  });

  it('首次 GET 失败后离开仍会读取最近记录，不把失败登记为空库', async () => {
    const first = deferred();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.fetch.mockReturnValueOnce(first.promise).mockResolvedValue(reply());
    const page = setup();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await act(async () => first.reject(new Error('首屏读取失败')));
    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败');
    page.go('/inspiration');
    expect(await recent().findByRole('link', { name: '真实服务笔记' })).toBeInTheDocument();
  });

  it('服务端确认空库后离开不重复读取最近记录', async () => {
    mocks.fetch.mockResolvedValue(reply([]));
    const page = setup();
    await screen.findByText('从一个想法开始');
    await waitFor(() => expect(page.client.getQueryState(['notes'])?.status).toBe('success'));
    page.go('/profile');
    expect(await recent().findByText('还没有笔记。')).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('已有可信投影不被新挂载笔记页的加载空初值清掉，首屏仍保留真实分页', async () => {
    const first = deferred();
    mocks.fetch.mockResolvedValueOnce(reply()).mockReturnValueOnce(first.promise);
    const page = setup('/profile');
    expect(await recent().findByRole('link', { name: '真实服务笔记' })).toBeInTheDocument();
    expect(page.client.getQueryData(['notes'])).toBeUndefined();
    page.go('/notes');
    await screen.findByText('正在加载笔记…');
    expect(recent().getByRole('link', { name: '真实服务笔记' })).toBeInTheDocument();
    await act(async () => first.resolve(reply()));
    expect(await screen.findByRole('button', { name: '加载更早的笔记' })).toBeInTheDocument();
    expect(recent().getByRole('link', { name: '真实服务笔记' })).toBeInTheDocument();
  });
});

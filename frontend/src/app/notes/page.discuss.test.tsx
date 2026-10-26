import React, { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, type WorkspaceContextValue } from '../../components/workspace/WorkspaceContext';
import NotesPage from './page';

const mocks = vi.hoisted(() => ({ query: 'highlight=source-note', userId: 'u1', push: vi.fn(), start: vi.fn(), protect: vi.fn((action: () => void) => action()), notes: [{ _id: 'source-note', title: '', content: '保存过的正文', contentText: '保存过的正文', contentJson: null, revision: 3, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' }, { _id: 'other-note', title: '另一篇笔记', content: '另一篇正文', contentText: '另一篇正文', contentJson: null, revision: 1, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' }] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock('next/dynamic', () => ({ default: (loader: () => Promise<{ default: React.ComponentType }>) => { const Lazy = React.lazy(loader); return (props: Record<string, unknown>) => <Suspense fallback={<p>加载视图</p>}><Lazy {...props} /></Suspense>; } }));
vi.mock('../../services/noteConversation', () => ({ startNoteConversation: mocks.start }));
vi.mock('./hooks/useAuthGuard', () => ({ useAuthGuard: () => ({ id: mocks.userId }) }));
vi.mock('./hooks/useNotes', () => ({ NoteWriteConflict: class extends Error {}, useNotes: () => ({ notes: mocks.notes, isLoading: false, isSuccess: true, createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(), refreshRecommendCache: vi.fn(), refetchNotes: vi.fn(), loadMoreNotes: vi.fn(), hasMoreNotes: false, isLoadingMore: false }) }));
const context: WorkspaceContextValue = { navigate: vi.fn(), requestAction: mocks.protect, registerEditor: vi.fn(() => vi.fn()), setRecentNotes: vi.fn() };
const page = () => <WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>;
const mount = () => render(page());
beforeEach(() => { vi.clearAllMocks(); mocks.query = 'highlight=source-note'; mocks.userId = 'u1'; mocks.protect.mockImplementation(action => action()); });

describe('真实笔记对话入口', () => {
  it('waits for accepted source binding, prevents duplicate starts and does not require a title', async () => {
    let resolve!: (id: string) => void; mocks.start.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    mount(); const trigger = await screen.findByRole('button', { name: '和 AI 讨论' });
    fireEvent.click(trigger); fireEvent.click(trigger);
    expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.start).toHaveBeenCalledWith('source-note', '');
    expect(trigger).toBeDisabled(); expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => resolve('server-chat'));
    expect(mocks.push).toHaveBeenCalledWith('/chat?session=server-chat');
  });
  it('keeps the readable source and retry action after a server rejection', async () => {
    mocks.start.mockRejectedValueOnce(new Error('来源不可用')); mount();
    fireEvent.click(await screen.findByRole('button', { name: '和 AI 讨论' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('来源不可用');
    expect(screen.getByRole('button', { name: '和 AI 讨论' })).toBeEnabled();
    expect(within(screen.getByRole('article', { name: '笔记阅读' })).getByText('保存过的正文')).toBeInTheDocument(); expect(mocks.push).not.toHaveBeenCalled();
  });
  it('does not navigate when a bound-session response arrives after leaving the page', async () => {
    let resolve!: (id: string) => void; mocks.start.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: '和 AI 讨论' }));
    view.unmount(); await act(async () => resolve('server-chat')); expect(mocks.push).not.toHaveBeenCalled();
  });
  it.each(['', 'highlight=other-note'])('ignores a delayed success after visiting %s and returning to the same source', async (query) => {
    let resolve!: (id: string) => void;
    mocks.start.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: '和 AI 讨论' }));
    mocks.query = query; view.rerender(page());
    mocks.query = 'highlight=source-note'; view.rerender(page());
    await act(async () => resolve('old-server-chat'));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '和 AI 讨论' })).toBeEnabled();
  });
  it.each(['', 'highlight=other-note'])('ignores a delayed failure after visiting %s and returning to the same source', async (query) => {
    let reject!: (error: Error) => void;
    mocks.start.mockReturnValue(new Promise<string>((_, r) => { reject = r; }));
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: '和 AI 讨论' }));
    mocks.query = query; view.rerender(page());
    mocks.query = 'highlight=source-note'; view.rerender(page());
    await act(async () => reject(new Error('旧来源请求失败')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '和 AI 讨论' })).toBeEnabled();
  });
  it('does not revive a delayed discussion after the account changes away and back', async () => {
    let resolve!: (id: string) => void;
    mocks.start.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: '和 AI 讨论' }));
    mocks.userId = 'u2'; view.rerender(page());
    mocks.userId = 'u1'; view.rerender(page());
    await act(async () => resolve('old-server-chat'));
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('invalidates a settled guarded navigation after leaving and returning to the source', async () => {
    let resolve!: (id: string) => void; let pendingNavigation!: () => void;
    mocks.start.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: '和 AI 讨论' }));
    mocks.protect.mockImplementationOnce(action => { pendingNavigation = action; });
    await act(async () => resolve('old-server-chat'));
    mocks.query = ''; view.rerender(page());
    mocks.query = 'highlight=source-note'; view.rerender(page());
    act(() => pendingNavigation());
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('checks the current editor guard again after the network request settles', async () => {
    let resolve!: (id: string) => void; let pendingNavigation!: () => void;
    mocks.start.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    mount(); fireEvent.click(await screen.findByRole('button', { name: '和 AI 讨论' }));
    mocks.protect.mockImplementationOnce(action => { pendingNavigation = action; });
    await act(async () => resolve('server-chat'));
    expect(mocks.push).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.protect).toHaveBeenCalledTimes(2));
    act(() => pendingNavigation()); expect(mocks.push).toHaveBeenCalledWith('/chat?session=server-chat');
  });
});

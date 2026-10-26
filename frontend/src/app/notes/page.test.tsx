import React, { Suspense } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, type WorkspaceContextValue } from '../../components/workspace/WorkspaceContext';
import type { Note } from './hooks/useNotes';
import NotesPage from './page';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), focused: { state: null } as Record<string, unknown>,
  data: {} as Record<string, unknown>, create: vi.fn(), update: vi.fn(), remove: vi.fn(), load: vi.fn(), retry: vi.fn(), request: vi.fn(),
  user: { id: 'u1' } as { id: string } | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => mocks.params }));
vi.mock('../../components/TopNavigation', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: (loader: () => Promise<{ default: React.ComponentType }>) => { const Lazy = React.lazy(loader); return (props: Record<string, unknown>) => <Suspense fallback={<div>加载视图</div>}><Lazy {...props} /></Suspense>; } }));
vi.mock('./hooks/useAuthGuard', () => ({ useAuthGuard: () => mocks.user }));
vi.mock('./hooks/useNotes', () => ({ NoteWriteConflict: class extends Error {}, useNotes: () => mocks.data }));
vi.mock('./hooks/useFocusedSourceNote', () => ({ useFocusedSourceNote: () => ({ retry: mocks.retry, captureMutation: vi.fn(), applyCanonical: vi.fn(), applyRecommendCache: vi.fn(), markUnavailable: vi.fn(), ...mocks.focused }) }));
vi.mock('./components/NoteWorkspaceReader', () => ({ default: ({ note, onEdit, onRelated, onDelete }: { note: Note; onEdit: () => void; onRelated: () => void; onDelete: () => void }) => <article aria-label="笔记阅读"><p>{note.contentText}</p><button onClick={onEdit}>编辑笔记</button><button onClick={onRelated}>相关笔记</button><button onClick={onDelete}>删除笔记</button></article> }));
vi.mock('./components/NoteWorkspaceEditor', () => ({ default: ({ onCancel }: { onCancel: () => void }) => <div aria-label="笔记编辑"><button onClick={onCancel}>取消编辑</button></div> }));
vi.mock('./components/RelatedNotesDrawer', () => ({ default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <aside aria-label="相关笔记">相关推荐</aside> : null }));

const note = { _id: 'n1', title: '一条记录', contentText: '真实正文', content: '真实正文', createdAt: '2026-10-24T01:00:00.000Z', revision: 1 } as Note;
const context: WorkspaceContextValue = { navigate: vi.fn(), requestAction: mocks.request, registerEditor: vi.fn(() => vi.fn()), setRecentNotes: vi.fn() };
const renderPage = () => render(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);

describe('notes workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.params = new URLSearchParams(); mocks.focused = { state: null }; mocks.user = { id: 'u1' };
    mocks.request.mockImplementation((action) => action());
    mocks.push.mockImplementation((href: string) => { mocks.params = new URLSearchParams(href.split('?')[1]); });
    mocks.data = { notes: [note], isLoading: false, isSuccess: true, createNote: mocks.create, updateNote: mocks.update, deleteNote: mocks.remove, refreshRecommendCache: vi.fn(), loadMoreNotes: mocks.load, hasMoreNotes: true, isLoadingMore: false, loadMoreError: null, refetchNotes: mocks.retry };
  });

  it('opens a real list record in separate reading and only opens related notes on demand', async () => {
    const view = renderPage();
    expect(screen.queryByLabelText('笔记阅读')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /一条记录/ }));
    expect(mocks.push).toHaveBeenCalledWith('/notes?highlight=n1', { scroll: false });
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    expect(await screen.findByLabelText('笔记阅读')).toHaveTextContent('真实正文');
    expect(screen.queryByRole('complementary', { name: '相关笔记' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '相关笔记' }));
    expect(await screen.findByRole('complementary', { name: '相关笔记' })).toBeInTheDocument();
  });

  it('reads an independent highlighted note without substituting a loaded record', async () => {
    mocks.params = new URLSearchParams('highlight=outside');
    mocks.focused = { state: { status: 'ready', note: { ...note, _id: 'outside', contentText: '未分页加载的原文' } } };
    renderPage();
    expect(await screen.findByLabelText('笔记阅读')).toHaveTextContent('未分页加载的原文');
    expect(within(screen.getByLabelText('笔记阅读')).queryByText('真实正文')).toBeNull();
  });

  it('shows missing source state and a guarded return without opening a different note', () => {
    mocks.params = new URLSearchParams('highlight=missing'); mocks.focused = { state: { status: 'missing' } };
    renderPage();
    expect(screen.getByText(/已删除或当前账号无权查看/)).toBeInTheDocument();
    expect(screen.queryByLabelText('笔记阅读')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回笔记列表' }));
    expect(mocks.request).toHaveBeenCalled(); expect(mocks.push).toHaveBeenCalledWith('/notes', { scroll: false });
  });

  it('keeps the compose URL until navigation leaves it, then returns to the list', async () => {
    mocks.params = new URLSearchParams('compose=1');
    const view = renderPage();
    expect(await screen.findByLabelText('笔记编辑')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.params.get('compose')).toBe('1');
    mocks.params = new URLSearchParams();
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    expect(screen.queryByLabelText('笔记编辑')).toBeNull();
    expect(screen.getByTestId('notes-list-scroll')).toBeVisible();
    mocks.params = new URLSearchParams('compose=1');
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    expect(await screen.findByLabelText('笔记编辑')).toBeInTheDocument();
  });

  it('preserves the loaded list and scroll position through reading and back', async () => {
    const view = renderPage();
    const scroll = screen.getByTestId('notes-list-scroll');
    scroll.scrollTop = 280;
    fireEvent.scroll(scroll);
    fireEvent.click(screen.getByRole('button', { name: /一条记录/ }));
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    await screen.findByLabelText('笔记阅读');
    fireEvent.click(screen.getByRole('button', { name: '返回笔记列表' }));
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    await waitFor(() => expect(screen.getByTestId('notes-list-scroll').scrollTop).toBe(280));
    fireEvent.click(screen.getByRole('button', { name: /加载更早的笔记/ }));
    expect(mocks.load).toHaveBeenCalled();
  });

  it('keeps a direct compose intent while authentication finishes loading', async () => {
    mocks.user = null; mocks.params = new URLSearchParams('compose=1');
    const view = renderPage();
    mocks.user = { id: 'u1' };
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    expect(await screen.findByLabelText('笔记编辑')).toBeInTheDocument();
  });

  it('keeps reading and confirmation on a failed deletion, and leaves only after success', async () => {
    mocks.params = new URLSearchParams('highlight=n1');
    mocks.remove.mockRejectedValueOnce(new Error('删除失败')).mockResolvedValueOnce(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '删除笔记' }));
    const dialog = screen.getByRole('dialog', { name: '删除笔记' });
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('删除失败');
    expect(mocks.push).not.toHaveBeenCalled(); expect(screen.getByLabelText('笔记阅读')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.push).toHaveBeenCalledWith('/notes', { scroll: false });
  });

  it('keeps server pagination order when an older note has a later updated time', () => {
    mocks.data.notes = [note, { ...note, _id: 'old', title: '旧记录', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z' }];
    renderPage();
    const rows = screen.getAllByRole('button', { name: /阅读笔记/ });
    expect(rows[0]).toHaveAccessibleName('阅读笔记：一条记录');
    expect(rows[1]).toHaveAccessibleName('阅读笔记：旧记录');
  });

  it('shows untitled prose once without a generated visual title strip', () => {
    mocks.data.notes = [{ ...note, title: '', contentText: '无标题记录正文', content: '无标题记录正文' }];
    renderPage();
    expect(screen.getAllByText('无标题记录正文')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '阅读笔记：无标题记录正文' })).toBeInTheDocument();
  });
});

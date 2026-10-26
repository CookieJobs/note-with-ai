import React, { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, type WorkspaceContextValue } from '../../components/workspace/WorkspaceContext';
import NotesPage from './page';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), remove: vi.fn(), recent: vi.fn(),
  userId: 'focus-user', highlight: 'focus-note',
  notes: [{ _id: 'focus-note', title: '阅读焦点', content: '真实阅读正文', contentText: '真实阅读正文', contentJson: null, revision: 1, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams('highlight=' + mocks.highlight) }));
vi.mock('next/dynamic', () => ({ default: (loader: () => Promise<{ default: React.ComponentType }>) => { const Lazy = React.lazy(loader); return (props: Record<string, unknown>) => <Suspense fallback={<p>加载视图</p>}><Lazy {...props} /></Suspense>; } }));
vi.mock('./hooks/useAuthGuard', () => ({ useAuthGuard: () => ({ id: mocks.userId }) }));
vi.mock('./hooks/useNotes', () => ({
  NoteWriteConflict: class extends Error {},
  useNotes: () => ({ notes: mocks.notes, isLoading: false, isSuccess: true, createNote: vi.fn(), updateNote: vi.fn(), deleteNote: mocks.remove, refreshRecommendCache: vi.fn(), refetchNotes: vi.fn(), loadMoreNotes: vi.fn(), hasMoreNotes: false, isLoadingMore: false }),
}));
const context: WorkspaceContextValue = { navigate: vi.fn(), requestAction: (action) => action(), registerEditor: vi.fn(() => vi.fn()), setRecentNotes: mocks.recent };

describe('real reading menu and page delete confirmation focus', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.userId = 'focus-user'; mocks.highlight = 'focus-note'; });

  it.each(['unmount', 'user', 'source-roundtrip', 'current'])('limits successful delete navigation to its current page session: %s', async (change) => {
    let finish!: () => void;
    mocks.remove.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const tree = () => <WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>;
    const view = render(tree());
    fireEvent.click(await screen.findByRole('button', { name: '更多笔记操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除笔记' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除笔记' })).getByRole('button', { name: '删除' }));
    expect(mocks.remove).toHaveBeenCalledWith('focus-note');
    if (change === 'unmount') view.unmount();
    if (change === 'user') { mocks.userId = 'next-user'; view.rerender(tree()); }
    if (change === 'source-roundtrip') {
      mocks.highlight = ''; view.rerender(tree());
      mocks.highlight = 'focus-note'; view.rerender(tree());
    }
    await act(async () => { finish(); });
    if (change === 'current') expect(mocks.push).toHaveBeenCalledWith('/notes', { scroll: false });
    else expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each(['取消', 'Escape', '遮罩'])('returns focus to the stable more trigger after %s closes the dialog', async (choice) => {
    render(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    const more = await screen.findByRole('button', { name: '更多笔记操作' });
    act(() => more.focus());
    fireEvent.click(more);
    const deleteItem = screen.getByRole('menuitem', { name: '删除笔记' });
    act(() => deleteItem.focus());
    fireEvent.click(deleteItem);
    const dialog = screen.getByRole('dialog', { name: '删除笔记' });
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
    expect(screen.queryByRole('menuitem')).toBeNull();
    if (choice === '取消') fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    else if (choice === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' });
    else fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(more).toHaveFocus();
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

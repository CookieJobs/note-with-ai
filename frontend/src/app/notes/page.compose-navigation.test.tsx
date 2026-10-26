import React, { Suspense, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext } from '../../components/workspace/WorkspaceContext';
import { useWorkspaceNavigation } from '../../components/workspace/useWorkspaceNavigation';
import NotesPage from './page';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), setHref: (_href: string) => {},
  recent: vi.fn(), create: vi.fn(), notes: [],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => mocks.params }));
vi.mock('next/dynamic', () => ({ default: (loader: () => Promise<{ default: React.ComponentType }>) => { const Lazy = React.lazy(loader); return (props: Record<string, unknown>) => <Suspense fallback={<p>加载视图</p>}><Lazy {...props} /></Suspense>; } }));
vi.mock('./hooks/useAuthGuard', () => ({ useAuthGuard: () => ({ id: 'compose-user' }) }));
vi.mock('./hooks/useNotes', () => ({
  NoteWriteConflict: class extends Error {},
  useNotes: () => ({ notes: mocks.notes, isLoading: false, isSuccess: true, createNote: mocks.create, updateNote: vi.fn(), deleteNote: vi.fn(), refreshRecommendCache: vi.fn(), refetchNotes: vi.fn(), loadMoreNotes: vi.fn(), hasMoreNotes: false, isLoadingMore: false }),
}));

function Harness() {
  const [href, setHref] = useState('/notes?compose=1');
  mocks.params = new URLSearchParams(href.split('?')[1]);
  mocks.setHref = setHref;
  const navigation = useWorkspaceNavigation();
  return <WorkspaceContext.Provider value={{ ...navigation, setRecentNotes: mocks.recent }}>
    <button onClick={() => navigation.navigate('/notes')}>侧栏笔记</button>
    <output aria-label="当前地址">{href}</output>
    <NotesPage />
    {navigation.pending && <div role="dialog" aria-label="离开新建笔记">
      <button onClick={navigation.cancel}>继续编辑</button>
      <button onClick={() => void navigation.saveAndContinue()}>保存后离开</button>
      <button onClick={navigation.discardAndContinue}>放弃后离开</button>
    </div>}
  </WorkspaceContext.Provider>;
}

describe('compose URL and real workspace navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    mocks.push.mockImplementation((href) => mocks.setHref(href));
    mocks.replace.mockImplementation((href) => mocks.setHref(href));
    mocks.create.mockResolvedValue({ _id: 'created-note', revision: 1 });
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), { getBoundingClientRect: () => new DOMRect(), getClientRects: () => [] as unknown as DOMRectList }));
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('returns from a clean composer using the real root navigate action', async () => {
    render(<Harness />);
    await screen.findByRole('textbox', { name: '笔记标题' });
    fireEvent.click(screen.getByRole('button', { name: '侧栏笔记' }));
    await waitFor(() => expect(screen.queryByLabelText('笔记编辑')).toBeNull());
    expect(screen.getByTestId('notes-list-scroll')).toBeVisible();
    expect(screen.getByLabelText('当前地址')).toHaveTextContent(/^\/notes$/);
  });

  it.each(['保存后离开', '放弃后离开'])('leaves the restored real draft through %s and reaches the list', async (choice) => {
    localStorage.setItem('quick-capture-draft:compose-user', JSON.stringify({ version: 2, title: '本机草稿', text: '真实草稿正文', json: null }));
    render(<Harness />);
    expect(await screen.findByRole('textbox', { name: '笔记标题' })).toHaveValue('本机草稿');
    fireEvent.click(screen.getByRole('button', { name: '侧栏笔记' }));
    expect(screen.getByRole('dialog', { name: '离开新建笔记' })).toBeInTheDocument();
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/notes?compose=1');
    fireEvent.click(screen.getByRole('button', { name: choice }));
    await waitFor(() => expect(screen.queryByLabelText('笔记编辑')).toBeNull());
    expect(screen.getByTestId('notes-list-scroll')).toBeVisible();
    expect(mocks.create).toHaveBeenCalledTimes(choice === '保存后离开' ? 1 : 0);
    expect(localStorage.getItem('quick-capture-draft:compose-user')).toBeNull();
  });

  it('keeps the URL and draft when leaving is canceled, and restores them after a remount', async () => {
    localStorage.setItem('quick-capture-draft:compose-user', JSON.stringify({ version: 2, title: '待继续的草稿', text: '不丢失的正文', json: null }));
    const view = render(<Harness />);
    await screen.findByRole('textbox', { name: '笔记标题' });
    fireEvent.click(screen.getByRole('button', { name: '侧栏笔记' }));
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('待继续的草稿');
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/notes?compose=1');
    view.unmount();
    render(<Harness />);
    expect(await screen.findByRole('textbox', { name: '笔记标题' })).toHaveValue('待继续的草稿');
  });

  it('projects a completed back/forward URL change and restores the existing browser draft', async () => {
    localStorage.setItem('quick-capture-draft:compose-user', JSON.stringify({ version: 2, title: '前进后恢复', text: '仍在本机的正文', json: null }));
    render(<Harness />);
    expect(await screen.findByRole('textbox', { name: '笔记标题' })).toHaveValue('前进后恢复');
    // The navigation hook guards the history event; this simulates the resulting router URL.
    act(() => mocks.setHref('/notes'));
    expect(screen.queryByLabelText('笔记编辑')).toBeNull();
    expect(screen.getByTestId('notes-list-scroll')).toBeVisible();
    act(() => mocks.setHref('/notes?compose=1'));
    expect(await screen.findByRole('textbox', { name: '笔记标题' })).toHaveValue('前进后恢复');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

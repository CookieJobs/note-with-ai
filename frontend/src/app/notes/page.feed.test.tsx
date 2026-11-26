import React, { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, type WorkspaceContextValue } from '../../components/workspace/WorkspaceContext';
import type { Note } from './hooks/useNotes';
import { noteDiscoveries } from '../../services/noteDiscoveries';
import NotesPage from './page';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), focused: { state: null } as Record<string, unknown>,
  data: {} as Record<string, unknown>, create: vi.fn(), update: vi.fn(), remove: vi.fn(), load: vi.fn(), retry: vi.fn(), request: vi.fn(),
  fetch: vi.fn(), user: { id: 'u1' } as { id: string } | null,
}));
vi.mock('../../services/noteDiscoveries', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/noteDiscoveries')>(),
  noteDiscoveries: { list: vi.fn(), session: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => mocks.params }));
vi.mock('../../utils/auth', () => ({ getUser: vi.fn(), isAuthenticated: vi.fn(), authFetch: mocks.fetch }));
vi.mock('../../components/TopNavigation', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: (loader: () => Promise<{ default: React.ComponentType }>) => { const Lazy = React.lazy(loader); return (props: Record<string, unknown>) => <Suspense fallback={<div>加载视图</div>}><Lazy {...props} /></Suspense>; } }));
vi.mock('./hooks/useAuthGuard', () => ({ useAuthGuard: () => mocks.user }));
vi.mock('./hooks/useNotes', () => ({ NoteWriteConflict: class extends Error {}, useNotes: () => mocks.data }));
vi.mock('./hooks/useFocusedSourceNote', () => ({ useFocusedSourceNote: () => ({ retry: mocks.retry, captureMutation: vi.fn(), applyCanonical: vi.fn(), applyRecommendCache: vi.fn(), markUnavailable: vi.fn(), ...mocks.focused }) }));
vi.mock('./components/NoteWorkspaceReader', () => ({ default: ({ note, onEdit, onRelated, onDelete }: { note: Note; onEdit: () => void; onRelated: () => void; onDelete: () => void }) => <article aria-label="笔记阅读"><p>{note.contentText}</p><button onClick={onEdit}>编辑笔记</button><button onClick={onRelated}>相关笔记</button><button onClick={onDelete}>删除笔记</button></article> }));
vi.mock('./components/NoteWorkspaceEditor', () => ({ default: ({ onCancel }: { onCancel: () => void }) => <div aria-label="笔记编辑"><button onClick={onCancel}>取消编辑</button></div> }));
vi.mock('./components/RelatedNotesDrawer', () => ({ default: ({ isOpen, onOpenNote }: { isOpen: boolean; onOpenNote: (id: string) => void }) => isOpen ? <aside aria-label="相关笔记"><button onClick={() => onOpenNote('n2')}>另一篇相关笔记</button></aside> : null }));

const note = { _id: 'n1', title: '一条记录', contentText: '真实正文', content: '真实正文', createdAt: '2026-10-24T01:00:00.000Z', revision: 1 } as Note;
const context: WorkspaceContextValue = { navigate: vi.fn(), requestAction: mocks.request, registerEditor: vi.fn(() => vi.fn()), setRecentNotes: vi.fn() };
const renderPage = () => render(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);

describe('notes list feed integration', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/notes');
    vi.clearAllMocks();
    vi.mocked(noteDiscoveries.list).mockResolvedValue({ items: [], available: false,
      automaticEnabled: false, timeZone: 'Asia/Shanghai', run: {status: 'idle'} });
    mocks.params = new URLSearchParams(); mocks.focused = { state: null }; mocks.user = { id: 'u1' };
    mocks.request.mockImplementation((action) => action());
    mocks.push.mockImplementation((href: string) => { mocks.params = new URLSearchParams(href.split('?')[1]); });
    mocks.data = { notes: [note], isLoading: false, isSuccess: true, createNote: mocks.create, updateNote: mocks.update, deleteNote: mocks.remove, refreshRecommendCache: vi.fn(), loadMoreNotes: mocks.load, hasMoreNotes: true, isLoadingMore: false, loadMoreError: null, refetchNotes: mocks.retry };
    mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes('/calendar')
      ? { success: true, data: { month: new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7), timezone:'Asia/Shanghai', noteCount:1, recordedDayCount:1, days:[] } }
      : { success:true, data: {notes:[{...note, _id:'outside', title:'库外匹配记录'}],pageInfo:{hasMore:false,nextCursor:null}} } }));
  });
  it('shows the discovery between quick capture and the feed, then opens its server conversation', async () => {
    vi.mocked(noteDiscoveries.list).mockResolvedValue({ items: [{
      id: 'finding', kind: 'connection', title: '两条记录的联系', observation: '一条观察', whyNow: '新线索',
      qualification: '样本有限', suggestedAction: '列一个对照表', status: 'ready', createdAt: '2026-11-21T00:00:00Z', evidence: [],
    }], available: true, automaticEnabled: true, timeZone: 'Asia/Shanghai', run: {status: 'completed'} });
    vi.mocked(noteDiscoveries.session).mockResolvedValue({ session: {id: 'bound', title: '发现', messages: []}, reused: false });
    renderPage();
    const capture = screen.getByRole('button', {name: '打开快速记录'});
    const open = await screen.findByRole('button', {name: '查看发现：两条记录的联系'});
    const feed = screen.getByRole('searchbox', {name: '搜索笔记'});
    expect(capture.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(open.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(open);
    expect(capture).not.toBeVisible();
    expect(screen.getByRole('button', {name: '返回笔记'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: '继续探索'}));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/chat?session=bound', {scroll: false}));
    expect(noteDiscoveries.session).toHaveBeenCalledWith('finding', undefined);
  });
  it('searches beyond the loaded feed without replacing the recent-note projection', async () => {
    const view=renderPage();
    expect(screen.getByRole('button',{name:'阅读笔记：一条记录'})).toBeInTheDocument();
    const input = screen.getByRole('searchbox',{name:'搜索笔记'});
    input.focus();
    fireEvent.change(input, {target:{value:'匹配'}});
    const result=await screen.findByRole('button',{name:'阅读笔记：库外匹配记录'});
    expect(input).toHaveFocus();
    expect(context.setRecentNotes).toHaveBeenLastCalledWith([expect.objectContaining({id:'n1'})]);
    fireEvent.click(result);
    expect(mocks.push).toHaveBeenLastCalledWith('/notes?highlight=outside',{scroll:false});
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    fireEvent.click(screen.getByRole('button',{name:'返回笔记'}));
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    expect(screen.getByRole('searchbox',{name:'搜索笔记'})).toHaveValue('匹配');
    expect(screen.getByRole('button',{name:'阅读笔记：库外匹配记录'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'清除搜索'}));
    expect(await screen.findByRole('button',{name:'阅读笔记：一条记录'})).toBeInTheDocument();
  });
  it('opens a cleared search-only card and retains its clear state when revisiting the query', async () => {
    const meltFrost = vi.fn().mockResolvedValue(0);
    mocks.data.meltFrost = meltFrost;
    mocks.fetch.mockResolvedValue({
      ok: true, json: async () => ({
        success: true,
        data: { notes: [{ ...note, _id: 'outside', title: '库外积雪', frostLayers: 1 }], pageInfo: { hasMore: false } },
      }),
    });
    renderPage();
    const input = screen.getByRole('searchbox', { name: '搜索笔记' });
    fireEvent.change(input, { target: { value: '库外' } });
    fireEvent.click(await screen.findByRole('button', { name: '抖落积雪（还剩 1 层）：库外积雪' }));
    expect(meltFrost).toHaveBeenCalledExactlyOnceWith('outside');
    const clearCard = await screen.findByRole('button', { name: '阅读笔记：库外积雪' });
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(screen.getByRole('button', { name: '阅读笔记：一条记录' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '库外' } });
    fireEvent.click(await screen.findByRole('button', { name: '阅读笔记：库外积雪' }));
    expect(clearCard).not.toHaveAttribute('data-frozen');
    expect(mocks.push).toHaveBeenCalledWith('/notes?highlight=outside', { scroll: false });
  });

  it('keeps the shared query focused when a topbar search makes the list shorter', async () => {
    const topbarActions = document.createElement('div');
    document.body.append(topbarActions);
    let reportPosition!: (bottom: number) => void;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        reportPosition = bottom => callback([{
          rootBounds: {top: 0}, boundingClientRect: {bottom},
        } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      observe() {}
      disconnect() {}
    });
    const page = render(<WorkspaceContext.Provider value={{ ...context, topbarActions }}><NotesPage /></WorkspaceContext.Provider>);
    try {
      Object.defineProperty(screen.getByTestId('notes-list-scroll'), 'clientHeight', {value: 600});
      fireEvent.change(screen.getByRole('searchbox', {name: '搜索笔记'}), {target: {value: '原关键词'}});
      const header = within(topbarActions);
      act(() => reportPosition(-10));
      fireEvent.click(header.getByRole('button', {name: '搜索笔记'}));
      const topInput = header.getByRole('searchbox', {name: '搜索笔记'});
      expect(topInput).toHaveValue('原关键词');
      fireEvent.change(topInput, {target: {value: '新关键词'}});
      act(() => reportPosition(20));
      expect(topInput).toHaveFocus();
      expect(await screen.findByRole('button', {name: '阅读笔记：库外匹配记录'})).toBeInTheDocument();
      expect(mocks.fetch).toHaveBeenCalledWith('/api/notes?q=' + encodeURIComponent('新关键词'), expect.anything());
      fireEvent.keyDown(topInput, {key: 'Escape'});
      expect(screen.getByRole('searchbox', {name: '搜索笔记'})).toHaveValue('新关键词');
      expect(topbarActions).toBeEmptyDOMElement();
    } finally {
      page.unmount();
      topbarActions.remove();
      vi.unstubAllGlobals();
    }
  });
  it('restores a neighboring card instead of the first record when the opened item disappears', () => {
    const many = Array.from({length:30}, (_, index) => ({...note, _id: 'note-' + index, title: '记录 ' + index}));
    mocks.data.notes = many;
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', {name:'阅读笔记：记录 20'}));
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    mocks.data.notes = many.filter(n => n._id !== 'note-20');
    mocks.params = new URLSearchParams();
    view.rerender(<WorkspaceContext.Provider value={context}><NotesPage /></WorkspaceContext.Provider>);
    expect(screen.getByRole('button', {name:'阅读笔记：记录 21'})).toHaveFocus();
  });
  it('keeps the existing full composer entry rather than adding inline saving', () => {
    renderPage(); fireEvent.click(screen.getByRole('button',{name:'打开快速记录'}));
    expect(mocks.push).toHaveBeenLastCalledWith('/notes?compose=1',{scroll:false});
    expect(screen.queryByRole('textbox',{name:'快速记录'})).not.toBeInTheDocument();
  });
});

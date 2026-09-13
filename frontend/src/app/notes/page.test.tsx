import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotesPage from './page';

const api = vi.hoisted(() => ({
  createNote: vi.fn(), authFetch: vi.fn(), loadMore: vi.fn(), userId: 'alice', notes: [] as any[], search: '',
  hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false,
}));
const editorPreload = vi.hoisted(() => vi.fn());
const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motionPreference.reduced,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(api.search) }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <nav>导航</nav> }));
vi.mock('./hooks/useAuthGuard', () => ({ useAuthGuard: () => ({ id: api.userId, email: 'alice@example.com' }) }));
vi.mock('../../utils/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../utils/auth')>()), authFetch: api.authFetch }));
vi.mock('./hooks/useNotes', () => ({ useNotes: () => ({
  notes: api.notes, isLoading: false, createNote: api.createNote, deleteNote: vi.fn(), updateNote: vi.fn(), refreshRecommendCache: vi.fn(),
  hasNextPage: api.hasNextPage, isFetchingNextPage: api.isFetchingNextPage, isFetchNextPageError: api.isFetchNextPageError, loadMore: api.loadMore,
}) }));
vi.mock('./components/ModernNoteCard', () => ({ default: ({ note, isHighlighted }: any) => <article data-highlighted={isHighlighted}>{note.title}</article> }));
vi.mock('./components/richTextEditorLoader', () => ({
  preloadRichTextEditor: editorPreload,
  preloadRichTextEditorFromIntent: editorPreload,
  loadRichTextEditor: vi.fn(),
}));
// The editor is a separately tested input boundary; keep the page, compose shell and draft hook real.
vi.mock('next/dynamic', () => ({ default: () => function Editor({ value, onChange }: any) {
  return <textarea aria-label="记录正文" value={value?.content?.map((p: any) => p.content?.map((t: any) => t.text).join('') || '').join('\n') || ''}
    onChange={event => onChange({ text: event.target.value, json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: event.target.value }] }] } })} />;
} }));

const created = { _id: 'saved-1', contentText: '内容', revision: 1, enrichment: { sourceRevision: 1, status: 'pending' } };
async function writeDraft(text = '这是一条尚未保存的想法') {
  fireEvent.click(screen.getByRole('button', { name: '打开快速记录' }));
  fireEvent.change(await screen.findByRole('textbox', { name: '记录正文' }), { target: { value: text } });
}

describe('desktop quick capture', () => {
  beforeEach(() => {
    localStorage.clear(); api.userId = 'alice'; api.notes = []; api.search = ''; api.hasNextPage = false; api.isFetchingNextPage = false; api.isFetchNextPageError = false;
    api.authFetch.mockReset(); api.loadMore.mockReset().mockResolvedValue(undefined); editorPreload.mockReset(); motionPreference.reduced = false; vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); api.createNote.mockReset().mockResolvedValue(created);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps a closed draft available after remount', async () => {
    const first = render(<NotesPage />);
    await writeDraft();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await screen.findByRole('button', { name: '打开快速记录' });
    expect(screen.getByText('继续编辑草稿…')).toBeInTheDocument();
    first.unmount();
    render(<NotesPage />);
    expect(await screen.findByText(/已恢复本机草稿/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开快速记录' }));
    expect(await screen.findByRole('textbox', { name: '记录正文' })).toHaveValue('这是一条尚未保存的想法');
  });

  it('replaces the focused editor session when the account changes', async () => {
    const page = render(<NotesPage />);
    await writeDraft('Alice 的草稿');
    const aliceEditor = screen.getByRole('textbox', { name: '记录正文' });
    aliceEditor.focus();
    api.userId = 'bob';
    page.rerender(<NotesPage />);
    const bobEditor = await screen.findByRole('textbox', { name: '记录正文' });
    expect(bobEditor).not.toBe(aliceEditor);
    expect(bobEditor).toHaveValue('');
    fireEvent.change(bobEditor, { target: { value: 'Bob 的草稿' } });
    expect(JSON.parse(localStorage.getItem('quick-capture-draft:alice')!).text).toBe('Alice 的草稿');
    expect(JSON.parse(localStorage.getItem('quick-capture-draft:bob')!).text).toBe('Bob 的草稿');
  });

  it('requires an explicit confirmation to discard and allows backing out', async () => {
    render(<NotesPage />);
    await writeDraft();
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保留草稿' }));
    expect(screen.getByRole('textbox', { name: '记录正文' })).toHaveValue('这是一条尚未保存的想法');
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }));
    await screen.findByRole('button', { name: '打开快速记录' });
    cleanup();
    render(<NotesPage />);
    fireEvent.click(screen.getByRole('button', { name: '打开快速记录' }));
    expect(await screen.findByRole('textbox', { name: '记录正文' })).toHaveValue('');
  });

  it('keeps the editor open until the server confirms, then separates AI processing from saving', async () => {
    let finish!: (note: typeof created) => void;
    api.createNote.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<NotesPage />);
    await writeDraft();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('textbox', { name: '记录正文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    await act(async () => { finish(created); });
    await screen.findByRole('button', { name: '打开快速记录' });
    expect(screen.getByRole('status')).toHaveTextContent('已保存到云端');
    expect(screen.getByRole('status')).toHaveTextContent('AI 正在后台');
  });

  it('exposes retry without losing input on failure', async () => {
    api.createNote.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(created);
    render(<NotesPage />);
    await writeDraft();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未保存到云端');
    expect(screen.getByRole('textbox', { name: '记录正文' })).toHaveValue('这是一条尚未保存的想法');
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存到云端'));
  });

  it('fetches and renders an owned highlighted note that is absent from page one', async () => {
    api.search = 'highlight=candidate-not-loaded';
    api.notes = [{ _id: 'page-one-note', title: '第一页笔记', content: '', contentText: '', revision: 1, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' }];
    api.authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { note: {
        _id: 'candidate-not-loaded', title: '关系目标', content: '只通过详情接口读取', contentText: '只通过详情接口读取',
        revision: 1, createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
      } } }),
    });

    render(<NotesPage />);

    expect(await screen.findByText('关系目标')).toBeInTheDocument();
    expect(screen.getByText('关系目标').closest('article')).toHaveAttribute('data-highlighted', 'true');
    expect(api.authFetch).toHaveBeenCalledWith('/api/notes/candidate-not-loaded', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('keeps cursor pagination user-controlled with explicit loading, retry, and end states', async () => {
    api.notes = [{ _id: 'page-one-note', title: '第一页笔记', content: '', contentText: '', revision: 1, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' }];
    api.hasNextPage = true;
    const page = render(<NotesPage />);

    const loadMore = screen.getByRole('button', { name: '加载更多笔记' });
    expect(loadMore).toHaveClass('min-h-11', 'min-w-11');
    fireEvent.click(loadMore);
    expect(api.loadMore).toHaveBeenCalledTimes(1);

    api.isFetchingNextPage = true;
    page.rerender(<NotesPage />);
    expect(screen.getByRole('button', { name: '正在加载更多笔记…' })).toBeDisabled();

    api.isFetchingNextPage = false;
    api.isFetchNextPageError = true;
    page.rerender(<NotesPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('加载更多笔记失败');
    expect(screen.getByRole('button', { name: '加载更多笔记' })).toBeEnabled();

    api.hasNextPage = false;
    api.isFetchNextPageError = false;
    page.rerender(<NotesPage />);
    expect(screen.getByText('已加载全部笔记')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('button', { name: '加载更多笔记' })).not.toBeInTheDocument();
  });

  it('does not preload the editor merely because the notes page remains open', () => {
    vi.useFakeTimers();
    render(<NotesPage />);

    act(() => { vi.advanceTimersByTime(1201); });

    expect(editorPreload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each([
    ['pointer hover', (trigger: HTMLElement) => fireEvent.pointerEnter(trigger)],
    ['focus', (trigger: HTMLElement) => fireEvent.focus(trigger)],
    ['touch', (trigger: HTMLElement) => fireEvent.touchStart(trigger)],
    ['keyboard intent', (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: 'Enter' })],
  ])('preloads the editor on capture trigger %s', (_intent, activate) => {
    render(<NotesPage />);

    activate(screen.getByRole('button', { name: '打开快速记录' }));

    expect(editorPreload).toHaveBeenCalledTimes(1);
  });

  it('preloads once when opening compose despite repeated intent signals', async () => {
    render(<NotesPage />);
    const trigger = screen.getByRole('button', { name: '打开快速记录' });

    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);
    fireEvent.touchStart(trigger);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);

    expect(editorPreload).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('textbox', { name: '记录正文' })).toBeInTheDocument();
  });

  it('bounds entrance motion to the initial visible note subset', () => {
    api.notes = Array.from({ length: 10 }, (_, index) => ({
      _id: `note-${index + 1}`,
      title: `笔记 ${index + 1}`,
      content: '',
      contentText: '',
      revision: 1,
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    }));
    render(<NotesPage />);

    expect(screen.getByText('笔记 8').closest('[data-note-list-motion]')).toHaveAttribute('data-note-list-motion', 'enter');
    expect(screen.getByText('笔记 9').closest('[data-note-list-motion]')).toHaveAttribute('data-note-list-motion', 'none');
    expect(screen.getByText('笔记 10').closest('[data-note-list-motion]')).toHaveAttribute('data-note-list-motion', 'none');
  });

  it('uses deterministic no-motion cards when reduced motion is requested', () => {
    motionPreference.reduced = true;
    api.notes = [{ _id: 'motion-note', title: '静止笔记', content: '', contentText: '', revision: 1, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' }];

    render(<NotesPage />);

    expect(screen.getByText('静止笔记').closest('[data-note-list-motion]')).toHaveAttribute('data-note-list-motion', 'none');
  });
});

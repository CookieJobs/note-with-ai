import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteWriteConflict, type Note } from '../hooks/useNotes';
import ModernNoteCard from './ModernNoteCard';

const { suggestNoteTitle } = vi.hoisted(() => ({ suggestNoteTitle: vi.fn() }));
vi.mock('../../../services/noteTitleSuggestions', () => ({ suggestNoteTitle }));

const note: Note = {
  _id: 'note-1',
  title: '旧标题',
  content: '正文',
  contentText: '正文',
  contentJson: null,
  summary: '',
  concepts: [],
  recommendCache: null,
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('ModernNoteCard title editing', () => {
  beforeEach(() => {
    suggestNoteTitle.mockReset();
    // jsdom lacks the Range geometry used when ProseMirror scrolls to its selection.
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getBoundingClientRect: () => new DOMRect(),
      getClientRects: () => [] as unknown as DOMRectList,
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lets untitled prose lead the reading order, with creation metadata after the content', async () => {
    render(<ModernNoteCard note={{ ...note, title: '' }} onRequestDelete={vi.fn()} updateNote={vi.fn()} />);
    const body = await screen.findByText('正文');
    const date = screen.getByText(/2026-08-19/);
    expect(body.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['', '旧标题'])('opens body editing from the common edit action and restores focus after canceling (title: %j)', async (title) => {
    const updateNote = vi.fn();
    render(<ModernNoteCard note={{ ...note, title }} onRequestDelete={vi.fn()} updateNote={updateNote} />);
    const edit = screen.getByRole('button', { name: '编辑笔记' });
    expect(edit.tagName).toBe('BUTTON');
    edit.focus();
    expect(edit).toHaveFocus();
    fireEvent.click(edit);
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue(title);
    const body = await screen.findByRole('textbox', { name: '笔记正文' });
    await waitFor(() => expect(body).toHaveFocus());
    expect(screen.queryByRole('button', { name: '编辑笔记' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('textbox', { name: '笔记标题' })).toBeNull();
    expect(updateNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑笔记' })).toHaveFocus());
  });

  it('returns keyboard focus to the same titled note after Escape', async () => {
    render(<ModernNoteCard note={note} onRequestDelete={vi.fn()} updateNote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑笔记标题：旧标题' }));
    const title = screen.getByRole('textbox', { name: '笔记标题' });
    title.focus();
    fireEvent.keyDown(title, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑笔记标题：旧标题' })).toHaveFocus());
  });

  it('keeps title controls out of reading and reveals the optional title field when editing the body', () => {
    render(<ModernNoteCard note={{ ...note, title: '' }} onRequestDelete={vi.fn()} updateNote={vi.fn()} />);
    expect(screen.getByText('正文')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '笔记标题' })).toBeNull();
    expect(screen.queryByText('添加标题')).toBeNull();
    expect(screen.queryByText('编辑标题')).toBeNull();
    expect(screen.queryByText('帮我拟个标题')).toBeNull();
    expect(screen.queryByText('点击添加标题')).toBeNull();
    expect(screen.queryByLabelText('添加关键词')).toBeNull();

    fireEvent.click(screen.getByText('正文'));
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '帮我拟个标题' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存标题' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '保存' })).toHaveLength(1);
  });

  it('enters the same editor from the title and keeps the draft when moving focus to its actions', () => {
    render(<ModernNoteCard note={note} onRequestDelete={vi.fn()} updateNote={vi.fn()} />);
    expect(screen.queryByText('帮我拟个标题')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑笔记标题：旧标题' }));
    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '本地标题' } });
    fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: '帮我拟个标题' }) });
    expect(input).toHaveValue('本地标题');
  });

  it('keeps the keyboard path from the body inside editing until Save or Cancel', async () => {
    const { container } = render(<ModernNoteCard note={note} onRequestDelete={vi.fn()} updateNote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑笔记标题：旧标题' }));
    const body = await screen.findByRole('textbox', { name: '笔记正文' });
    const focusable = Array.from(container.querySelectorAll('button, input, [role="textbox"]')).filter((element) => !(element as HTMLButtonElement).disabled && (element as HTMLElement).tabIndex >= 0);
    const next = focusable[focusable.indexOf(body) + 1] as HTMLElement;
    expect(next).toHaveAccessibleName('取消');
    act(() => { body.focus(); next.focus(); });
    await waitFor(() => expect(screen.getByRole('textbox', { name: '笔记正文' })).toBeInTheDocument());
    act(() => { screen.getByRole('button', { name: '保存' }).focus(); });
    expect(screen.getByRole('textbox', { name: '笔记正文' })).toBeInTheDocument();
  });

  it('fills and undoes an AI suggestion only in the draft, then cancels the whole edit', async () => {
    suggestNoteTitle.mockResolvedValue({ title: '建议标题' });
    const updateNote = vi.fn();
    render(<ModernNoteCard note={note} userId="user-1" onRequestDelete={vi.fn()} updateNote={updateNote} />);
    fireEvent.click(screen.getByText('正文'));
    fireEvent.click(screen.getByRole('button', { name: '帮我拟个标题' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('建议标题'));
    expect(updateNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '撤销生成' }));
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('旧标题');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('textbox', { name: '笔记标题' })).toBeNull();
    expect(screen.queryByText('帮我拟个标题')).toBeNull();
    expect(screen.getByText('旧标题')).toBeInTheDocument();
  });

  it('does not reopen an editor when a canceled generation returns late', async () => {
    let finish!: (value: { title: string }) => void;
    suggestNoteTitle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<ModernNoteCard note={{ ...note, title: '' }} userId="user-1" onRequestDelete={vi.fn()} updateNote={vi.fn()} />);
    fireEvent.click(screen.getByText('正文'));
    fireEvent.click(screen.getByRole('button', { name: '帮我拟个标题' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await act(async () => { finish({ title: '迟到标题' }); });
    expect(screen.queryByText('迟到标题')).toBeNull();
    expect(screen.queryByRole('textbox', { name: '笔记标题' })).toBeNull();
    expect(screen.queryByText('帮我拟个标题')).toBeNull();
  });

  it('returns to an untitled reading card after saving a cleared title', async () => {
    const updateNote = vi.fn().mockResolvedValue({ ...note, title: '', revision: 5 });
    render(<ModernNoteCard note={note} onRequestDelete={vi.fn()} updateNote={updateNote} />);
    fireEvent.click(screen.getByText('旧标题'));
    fireEvent.change(screen.getByRole('textbox', { name: '笔记标题' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '笔记标题' })).toBeNull());
    expect(updateNote).toHaveBeenCalledWith({ noteId: 'note-1', expectedRevision: 4, changes: { title: '' } });
    expect(screen.queryByRole('button', { name: /编辑笔记标题/ })).toBeNull();
    expect(screen.queryByText('帮我拟个标题')).toBeNull();
    expect(await screen.findByText('正文')).toBeInTheDocument();
  });

  it('keeps a blank title optional and hides AI when an image note has no naming text', async () => {
    const imageNote = { ...note, title: '', content: '', contentText: '![照片](/note-image.jpg)', contentJson: {
      type: 'doc', content: [{ type: 'image', attrs: { src: '/note-image.jpg' } }],
    } };
    const { container } = render(<ModernNoteCard note={imageNote} onRequestDelete={vi.fn()} updateNote={vi.fn()} />);
    await act(async () => { fireEvent.click(container.querySelector('img')!); });
    expect(screen.getByRole('textbox', { name: '笔记标题' })).not.toBeRequired();
    expect(screen.queryByRole('button', { name: '帮我拟个标题' })).toBeNull();
  });

  it('keeps a title conflict visible through the native save mousedown-to-blur sequence and retries explicitly', async () => {
    const current: Note = {
      ...note,
      title: '服务端标题',
      revision: 5,
      enrichment: { sourceRevision: 5, status: 'pending' },
    };
    const updateNote = vi.fn()
      .mockRejectedValueOnce(new NoteWriteConflict(current))
      .mockResolvedValueOnce({
        ...current,
        title: '本地标题',
        revision: 6,
        enrichment: { sourceRevision: 6, status: 'pending' },
      });
    render(
      <ModernNoteCard
        note={note}
        onRequestDelete={vi.fn()}
        updateNote={updateNote}
      />,
    );

    fireEvent.click(screen.getByText('旧标题'));
    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '本地标题' } });
    const save = screen.getByRole('button', { name: '保存' });
    fireEvent.mouseDown(save);
    fireEvent.blur(input, { relatedTarget: save });
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('笔记已被其他写入更新'));
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('本地标题');
    expect(screen.getByRole('alert')).toHaveTextContent('服务端标题');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(2));
    expect(updateNote).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedRevision: 5 }));
  });

  it('discards a title change only through explicit cancel', () => {
    render(
      <ModernNoteCard
        note={note}
        onRequestDelete={vi.fn()}
        updateNote={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('旧标题'));
    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '不会保存' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('textbox', { name: '笔记标题' })).toBeNull();
    expect(screen.getByText('旧标题')).toBeInTheDocument();
  });

  it('uses Ctrl+Enter for a deferred save and preserves a title conflict for explicit retry', async () => {
    let rejectWrite!: (error: Error) => void;
    const current: Note = {
      ...note,
      title: '服务端标题',
      revision: 5,
      enrichment: { sourceRevision: 5, status: 'pending' },
    };
    const updateNote = vi.fn()
      .mockImplementationOnce(() => new Promise<Note>((_resolve, reject) => { rejectWrite = reject; }))
      .mockResolvedValueOnce({
        ...current,
        title: '本地标题',
        revision: 6,
        enrichment: { sourceRevision: 6, status: 'pending' },
      });
    render(
      <ModernNoteCard
        note={note}
        onRequestDelete={vi.fn()}
        updateNote={updateNote}
      />,
    );

    fireEvent.click(screen.getByText('旧标题'));
    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '本地标题' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    rejectWrite(new NoteWriteConflict(current));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('笔记已被其他写入更新'));
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('本地标题');
    expect(screen.getByRole('alert')).toHaveTextContent('服务端标题');

    fireEvent.keyDown(screen.getByRole('textbox', { name: '笔记标题' }), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(2));
    expect(updateNote).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedRevision: 5 }));
  });

  it('does not submit a title on plain Enter or while confirming Chinese input', () => {
    const updateNote = vi.fn();
    render(<ModernNoteCard note={note} onRequestDelete={vi.fn()} updateNote={updateNote} />);
    fireEvent.click(screen.getByText('旧标题'));
    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(updateNote).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateNote).not.toHaveBeenCalled();
    expect(input).toHaveValue('新标题');
  });
});

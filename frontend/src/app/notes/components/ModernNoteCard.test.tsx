import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteWriteConflict, type Note } from '../hooks/useNotes';
import ModernNoteCard from './ModernNoteCard';

const noteCardStyles = readFileSync(join(process.cwd(), 'src/app/notes/styles/note-card.module.scss'), 'utf8');
const noteCardSource = readFileSync(join(process.cwd(), 'src/app/notes/components/ModernNoteCard.tsx'), 'utf8');
const memory = vi.hoisted(() => ({
  getPreference: vi.fn().mockResolvedValue({ noteId: 'note-1', included: true }),
  savePreference: vi.fn().mockResolvedValue({ noteId: 'note-1', included: false }),
}));

vi.mock('../../../services/memoryService', () => ({
  getNoteAiPreference: memory.getPreference,
  saveNoteAiPreference: memory.savePreference,
}));

const note: Note = {
  _id: 'note-1',
  title: '旧标题',
  content: '正文',
  contentText: '正文',
  contentJson: null,
  summary: '',
  concepts: [],
  keywords: [],
  recommendCache: null,
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

const noteWithKeywords: Note = {
  ...note,
  keywords: ['计划', '长关键词用于窄屏换行'],
};

describe('ModernNoteCard title conflict feedback', () => {
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
    const input = screen.getByPlaceholderText('添加标题...');
    fireEvent.change(input, { target: { value: '本地标题' } });
    const save = screen.getByLabelText('保存标题');
    fireEvent.mouseDown(save);
    fireEvent.blur(input, { relatedTarget: save });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('笔记已被其他写入更新'));
    expect(screen.getByPlaceholderText('添加标题...')).toHaveValue('本地标题');
    expect(screen.getByRole('alert')).toHaveTextContent('服务端标题');

    fireEvent.mouseDown(screen.getByLabelText('保存标题'));
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(2));
    expect(updateNote).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedRevision: 5 }));
  });

  it('still cancels a title edit when focus leaves without starting a save', () => {
    render(
      <ModernNoteCard
        note={note}
        onRequestDelete={vi.fn()}
        updateNote={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('旧标题'));
    const input = screen.getByPlaceholderText('添加标题...');
    fireEvent.change(input, { target: { value: '不会保存' } });
    fireEvent.blur(input, { relatedTarget: document.body });

    expect(screen.queryByPlaceholderText('添加标题...')).toBeNull();
    expect(screen.getByText('旧标题')).toBeInTheDocument();
  });

  it('keeps a title conflict visible when Enter starts a deferred save before a later blur', async () => {
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
    const input = screen.getByPlaceholderText('添加标题...');
    fireEvent.change(input, { target: { value: '本地标题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input, { relatedTarget: document.body });
    rejectWrite(new NoteWriteConflict(current));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('笔记已被其他写入更新'));
    expect(screen.getByPlaceholderText('添加标题...')).toHaveValue('本地标题');
    expect(screen.getByRole('alert')).toHaveTextContent('服务端标题');

    fireEvent.keyDown(screen.getByPlaceholderText('添加标题...'), { key: 'Enter' });
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(2));
    expect(updateNote).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedRevision: 5 }));
  });
});

describe('ModernNoteCard touch-safe actions', () => {
  it('loads the read-only rich text viewer outside the initial Notes entry chunk', () => {
    expect(noteCardSource).toContain("dynamic(() => import('./RichTextViewer')");
    expect(noteCardSource).not.toContain("import RichTextViewer from './RichTextViewer'");
  });

  it('presents the AI participation change as a named menu action, not an invalid pressed menuitem', async () => {
    render(
      <ModernNoteCard
        note={note}
        onRequestDelete={vi.fn()}
        updateNote={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '笔记操作' }));

    const action = await screen.findByRole('menuitem', { name: '设为不参与 AI' });
    expect(action).not.toHaveAttribute('aria-pressed');
  });

  it('opens related notes from a visible named action without hover', () => {
    const onOpenRelated = vi.fn();
    render(
      <ModernNoteCard
        note={note}
        onRequestDelete={vi.fn()}
        updateNote={vi.fn()}
        onOpenRelated={onOpenRelated}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看相关笔记' }));

    expect(onOpenRelated).toHaveBeenCalledWith('note-1');
  });

  it('reduces card motion when the user requests reduced motion', () => {
    expect(noteCardStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(noteCardStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.noteCard\s*,[\s\S]*?\.noteCard\s+\*/);
    expect(noteCardStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none\s*!important/);
    expect(noteCardStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition:\s*none\s*!important/);
    expect(noteCardStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transform:\s*none\s*!important/);
  });

  it('activates title, relationship, and secondary actions with the keyboard', async () => {
    const onOpenRelated = vi.fn();
    const onRequestDelete = vi.fn();
    const onPublish = vi.fn();
    memory.savePreference.mockClear();
    render(
      <ModernNoteCard
        note={note}
        onRequestDelete={onRequestDelete}
        updateNote={vi.fn()}
        onOpenRelated={onOpenRelated}
        onPublish={onPublish}
      />,
    );

    const related = screen.getByRole('button', { name: '查看相关笔记' });
    related.focus();
    fireEvent.keyDown(related, { key: 'Enter' });
    expect(onOpenRelated).toHaveBeenCalledWith('note-1');

    const trigger = screen.getByRole('button', { name: '笔记操作' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const publish = await screen.findByRole('menuitem', { name: '公开笔记' });
    await waitFor(() => expect(publish).toHaveFocus());
    fireEvent.keyDown(publish, { key: 'Enter' });
    expect(onPublish).toHaveBeenCalledWith('note-1');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const ai = await screen.findByRole('menuitem', { name: '设为不参与 AI' });
    fireEvent.keyDown(ai, { key: 'Enter' });
    await waitFor(() => expect(memory.savePreference).toHaveBeenCalledWith('note-1', false));

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const publishAgain = await screen.findByRole('menuitem', { name: '公开笔记' });
    fireEvent.keyDown(publishAgain, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '恢复参与 AI' }), { key: 'ArrowDown' });
    const remove = screen.getByRole('menuitem', { name: '删除笔记' });
    await waitFor(() => expect(remove).toHaveFocus());
    fireEvent.keyDown(remove, { key: 'Enter' });
    expect(onRequestDelete).toHaveBeenCalledWith('note-1', expect.objectContaining({ current: trigger }));

    const title = screen.getByRole('button', { name: '编辑标题' });
    title.focus();
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(screen.getByPlaceholderText('添加标题...')).toHaveFocus();
  });

  it('uses separate semantic edit and delete buttons for each keyword without nested interactive controls', () => {
    render(
      <ModernNoteCard
        note={noteWithKeywords}
        onRequestDelete={vi.fn()}
        updateNote={vi.fn().mockResolvedValue(noteWithKeywords)}
      />,
    );

    expect(screen.getByRole('button', { name: '编辑关键词：计划' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除关键词：计划' })).toBeInTheDocument();
    expect(document.querySelector('[role="button"] button, button button')).toBeNull();
  });

  it('edits and deletes keywords from their native keyboard controls without bubbling deletion to the card', async () => {
    const updateNote = vi.fn().mockResolvedValue(noteWithKeywords);
    const cardClick = vi.fn();
    render(
      <div onClick={cardClick}>
        <ModernNoteCard
          note={noteWithKeywords}
          onRequestDelete={vi.fn()}
          updateNote={updateNote}
        />
      </div>,
    );

    const edit = screen.getByRole('button', { name: '编辑关键词：计划' });
    fireEvent.keyDown(edit, { key: 'Enter' });
    expect(screen.getByDisplayValue('计划')).toHaveFocus();
    fireEvent.keyDown(screen.getByDisplayValue('计划'), { key: 'Escape' });

    const remove = screen.getByRole('button', { name: '删除关键词：计划' });
    fireEvent.keyDown(remove, { key: 'Enter' });
    await waitFor(() => expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
      changes: { keywords: ['长关键词用于窄屏换行'] },
    })));
    expect(cardClick).not.toHaveBeenCalled();
  });

  it('keeps 44px keyword controls in normal-flow wrappers so adjacent chips cannot overlap', () => {
    expect(noteCardStyles).toMatch(/\.keywordControl\s*\{[^}]*display:\s*grid[^}]*gap:\s*[^;}]+/);
    expect(noteCardStyles).toMatch(/\.keywordEditBtn\s*\{[^}]*min-height:\s*44px/);
    expect(noteCardStyles).toMatch(/\.keywordDeleteBtn\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
    expect(noteCardStyles).not.toMatch(/\.keywordDeleteBtn\s*\{[^}]*position:\s*absolute/);
  });
});

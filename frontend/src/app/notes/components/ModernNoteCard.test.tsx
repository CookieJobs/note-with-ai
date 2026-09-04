import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteWriteConflict, type Note } from '../hooks/useNotes';
import ModernNoteCard from './ModernNoteCard';
import type { NoteRelationship } from '../types/relationships';

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

const relationship: NoteRelationship = {
  relationshipId: 'relationship:note-1:4:note-2:1',
  source: { noteId: 'note-1', revision: 4, excerpt: '正文', occurredAt: '2026-08-19T00:00:00.000Z' },
  candidate: { noteId: 'note-2', revision: 1, excerpt: '过去的正文', occurredAt: '2026-08-18T00:00:00.000Z' },
  kind: 'continuation',
  headline: '一条关系',
  explanation: '两条记录有联系。',
  confidence: 'supported',
  generatedAt: '2026-08-19T00:00:00.000Z',
};

describe('ModernNoteCard title conflict feedback', () => {
  it('exposes a visible relationship entry in the card body when the cached evidence is current', () => {
    const onClick = vi.fn();
    render(
      <ModernNoteCard
        note={{ ...note, recommendCache: { sourceRevision: 4, relationships: [relationship] } as Note['recommendCache'] }}
        onRequestDelete={vi.fn()}
        updateNote={vi.fn()}
        onClick={onClick}
      />,
    );

    const entry = screen.getByRole('button', { name: '发现 1 条关系线索' });
    expect(entry).toBeInTheDocument();
    fireEvent.click(entry);
    expect(onClick).toHaveBeenCalledTimes(1);
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

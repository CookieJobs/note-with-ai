import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NotesFeed from './NotesFeed';
import type { Note } from '../hooks/useNotes';
const note = (id: string, createdAt = '2026-11-08T01:00:00Z') => ({ _id: id, title: id, content: '正文', contentText: '正文', revision: 1, createdAt, updatedAt: createdAt } as Note);
describe('note feed cards', () => {
  it('keeps API order in the keyboard DOM and opens the original note', () => {
    const onOpen = vi.fn();
    render(<NotesFeed notes={[note('newest'), note('older')]} onOpen={onOpen} />);
    expect(screen.getAllByRole('button').map(b => b.getAttribute('data-note-id'))).toEqual(['newest', 'older']);
    fireEvent.click(screen.getByRole('button', {name:'阅读笔记：older'}));
    expect(onOpen).toHaveBeenCalledWith('older');
  });
  it('allows historical notes with a missing creation date to remain readable', () => {
    render(<NotesFeed notes={[note('历史笔记', '')]} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', {name:'阅读笔记：历史笔记'})).toHaveTextContent('正文');
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  });
});

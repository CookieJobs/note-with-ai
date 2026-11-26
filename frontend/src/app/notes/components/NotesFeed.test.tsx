import { act, fireEvent, render, screen } from '@testing-library/react';
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
  it('shows feedback and blocks click-through while the last layer is pending', async () => {
    const onOpen = vi.fn();
    let complete!: (layers: number) => void;
    const onMelt = vi.fn(() => new Promise<number>(resolve => { complete = resolve; }));
    const frozen = { ...note('frozen'), frostLayers: 1 };
    const { rerender } = render(<NotesFeed notes={[frozen]} onOpen={onOpen} onMelt={onMelt} />);
    expect(screen.getByText('抖落积雪 · 还剩 1 层')).toBeVisible();
    const button = screen.getByRole('button', { name: '抖落积雪（还剩 1 层）：frozen' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onMelt).toHaveBeenCalledExactlyOnceWith('frozen');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(onOpen).not.toHaveBeenCalled();

    await act(async () => complete(0));
    rerender(<NotesFeed notes={[{ ...frozen, frostLayers: 0 }]} onOpen={onOpen} onMelt={onMelt} />);
    expect(screen.getByText('打开笔记')).toBeVisible();
    expect(button.parentElement).toHaveAttribute('data-snow-header', 'true');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith('frozen');
  });

  it('reuses each corner crystal while redistributing it on every confirmed melt', async () => {
    const onOpen = vi.fn();
    const onMelt = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const frozen = note('snow');
    const feed = (frostLayers: number) => <NotesFeed notes={[{ ...frozen, frostLayers }]} onOpen={onOpen} onMelt={onMelt} />;
    const { container, rerender } = render(feed(3));
    const crystals = () => Array.from(container.querySelectorAll('[data-frost-crystal]'));
    const initial = crystals();
    expect(initial.length).toBeGreaterThan(0);
    let positions = initial.map(flake => flake.getAttribute('style'));

    for (const layers of [2, 1, 0]) {
      await act(async () => { fireEvent.click(screen.getByRole('button')); });
      rerender(feed(layers));
      const moved = crystals();
      expect(moved).toHaveLength(initial.length);
      moved.forEach((flake, index) => {
        expect(flake).toBe(initial[index]);
        expect(flake.getAttribute('style')).not.toBe(positions[index]);
      });
      positions = moved.map(flake => flake.getAttribute('style'));
    }

    expect(container.querySelector('[data-frost-corner]')).toHaveAttribute('data-frost-corner', '0');
    expect(onOpen).not.toHaveBeenCalled();
  });
  it('opens a fully thawed card normally', () => {
    const onOpen = vi.fn();
    const onMelt = vi.fn();
    render(<NotesFeed notes={[{ ...note('clear'), frostLayers: 0 }]} onOpen={onOpen} onMelt={onMelt} />);
    fireEvent.click(screen.getByRole('button', { name: '阅读笔记：clear' }));
    expect(onOpen).toHaveBeenCalledWith('clear');
    expect(onMelt).not.toHaveBeenCalled();
  });
});

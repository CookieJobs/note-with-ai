import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NotesLoadMoreFooter from './NotesLoadMoreFooter';

describe('NotesLoadMoreFooter', () => {
  it('keeps only the chronological continuation action in the list footer', () => {
    const onLoadMore = vi.fn();

    render(<NotesLoadMoreFooter hasMore onLoadMore={onLoadMore} />);

    expect(screen.queryByText('已显示 30 条笔记')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更早的笔记' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('shows a disabled in-place loading state', () => {
    render(<NotesLoadMoreFooter hasMore isLoading onLoadMore={vi.fn()} />);

    expect(screen.getByRole('button', { name: '正在加载更早的笔记…' })).toBeDisabled();
  });

  it('keeps a retry action beside a load failure', () => {
    const onLoadMore = vi.fn();

    render(<NotesLoadMoreFooter hasMore error="加载更多笔记失败" onLoadMore={onLoadMore} />);

    expect(screen.getByText('加载失败，请重试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('confirms the end of the list when every note has been shown', () => {
    render(<NotesLoadMoreFooter hasMore={false} onLoadMore={vi.fn()} />);

    expect(screen.getByText('已显示全部笔记')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

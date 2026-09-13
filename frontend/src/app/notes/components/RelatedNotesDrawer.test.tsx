import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../hooks/useNotes';
import { fetchRelatedNotes } from '../services/relatedNotes';
import RelatedNotesDrawer from './RelatedNotesDrawer';

vi.mock('../services/relatedNotes', () => ({ fetchRelatedNotes: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const note: Note = {
  _id: 'note-1',
  title: '本周阅读计划',
  content: '正文',
  contentText: '正文',
  contentJson: null,
  summary: '',
  concepts: [],
  keywords: [],
  recommendCache: {
    sourceRevision: 4,
    byCandidateId: {},
  },
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('RelatedNotesDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders endpoint summaries that are absent from the loaded notes page as navigable relationships', async () => {
    vi.mocked(fetchRelatedNotes).mockResolvedValue([{
      id: 'candidate-not-loaded',
      title: '还没有加载的笔记',
      contentText: '这条笔记来自关系摘要接口。',
      createdAt: '2026-09-12T00:00:00.000Z',
      type: '同一主题',
      reason: '都在讨论阅读计划。',
      scoreBand: 'supported',
    }]);

    render(
      <RelatedNotesDrawer
        isOpen
        onClose={vi.fn()}
        selectedNote={note}
      />,
    );

    const target = await screen.findByRole('link', { name: '还没有加载的笔记' });
    expect(target).toHaveAttribute('href', '/notes?highlight=candidate-not-loaded');
    expect(target).toHaveClass('min-h-11', 'min-w-11');
    expect(screen.getByText('都在讨论阅读计划。')).toBeInTheDocument();
    expect(screen.queryByText(/综合分|向量\(s1\)|模型\(s2\)/)).not.toBeInTheDocument();
  });

  it('never renders a late A response after the source changes to B', async () => {
    let resolveA!: (value: any) => void;
    let resolveB!: (value: any) => void;
    vi.mocked(fetchRelatedNotes).mockImplementation((noteId) => new Promise((resolve) => {
      if (noteId === 'note-1') resolveA = resolve;
      else resolveB = resolve;
    }));
    const { rerender } = render(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNote={note} />);
    rerender(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNote={{ ...note, _id: 'note-2', title: 'B' }} />);

    await act(async () => { resolveA([{
      id: 'a', title: 'A 的结果', contentText: '', createdAt: '2026-09-12T00:00:00.000Z', type: '', reason: '', scoreBand: 'possible',
    }]); });
    expect(screen.queryByText('A 的结果')).not.toBeInTheDocument();

    await act(async () => { resolveB([{
      id: 'b', title: 'B 的结果', contentText: '', createdAt: '2026-09-12T00:00:00.000Z', type: '', reason: '', scoreBand: 'possible',
    }]); });
    expect(await screen.findByText('B 的结果')).toBeInTheDocument();
  });

  it('exposes loading, error retry, and empty states without falling back to local cache entries', async () => {
    vi.mocked(fetchRelatedNotes).mockRejectedValue(new Error('offline'));
    const { rerender } = render(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNote={note} />);

    expect(screen.getByRole('status')).toHaveTextContent('正在加载相关笔记');
    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载相关笔记');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(fetchRelatedNotes).toHaveBeenCalledTimes(2));

    vi.mocked(fetchRelatedNotes).mockResolvedValue([]);
    rerender(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNote={{ ...note, _id: 'note-2' }} />);
    expect(await screen.findByText('暂无相关笔记')).toBeInTheDocument();
  });

  it('refreshes a stale source before requesting its summaries again', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetchRelatedNotes)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'candidate-1', title: '新结果', contentText: '', createdAt: '2026-09-12T00:00:00.000Z',
        type: '延伸思考', reason: '刷新后得到的关系。', scoreBand: 'possible',
      }]);

    render(
      <RelatedNotesDrawer
        isOpen
        onClose={vi.fn()}
        selectedNote={{
          ...note,
          recommendCache: { sourceRevision: 3, byCandidateId: { 'candidate-1': { s2: 0.8 } } },
        }}
        onRefreshRecommendCache={refresh}
      />,
    );

    expect(await screen.findByRole('link', { name: '新结果' })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledWith('note-1');
    expect(fetchRelatedNotes).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed stale-cache refresh when only the source timestamp changes', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('stale'));
    vi.mocked(fetchRelatedNotes).mockResolvedValue([]);
    const staleNote = {
      ...note,
      recommendCache: { sourceRevision: 3, byCandidateId: { 'candidate-1': { s2: 0.8 } } },
    };
    const { rerender } = render(
      <RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNote={staleNote} onRefreshRecommendCache={refresh} />,
    );

    expect(await screen.findByText('相关推荐更新失败，显示当前可用结果。')).toBeInTheDocument();
    rerender(
      <RelatedNotesDrawer
        isOpen
        onClose={vi.fn()}
        selectedNote={{ ...staleNote, updatedAt: '2026-08-19T00:00:04.000Z' }}
        onRefreshRecommendCache={refresh}
      />,
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('uses a labelled modal drawer and restores focus after Escape closes it', async () => {
    vi.mocked(fetchRelatedNotes).mockResolvedValue([]);
    function ControlledDrawer() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>查看关联</button>
          <RelatedNotesDrawer isOpen={open} onClose={() => setOpen(false)} selectedNote={note} />
        </>
      );
    }

    render(<ControlledDrawer />);
    const trigger = screen.getByRole('button', { name: '查看关联' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: '相关笔记' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '相关笔记' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

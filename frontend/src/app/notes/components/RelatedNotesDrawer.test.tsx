import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Note } from '../hooks/useNotes';
import RelatedNotesDrawer from './RelatedNotesDrawer';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const note: Note = {
  _id: 'note-1',
  title: '标题',
  content: '正文',
  contentText: '正文',
  contentJson: null,
  summary: '',
  concepts: [],
  keywords: [],
  recommendCache: {
    sourceRevision: 4,
    byCandidateId: {
      'candidate-1': { s2: 0.9 },
    },
  },
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('RelatedNotesDrawer recommendation refresh state', () => {
  it('does not retry a failed refresh when a same-revision list snapshot changes timestamps', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('stale'));
    const { rerender } = render(
      <RelatedNotesDrawer
        isOpen
        onClose={vi.fn()}
        selectedNoteId="note-1"
        allNotes={[note]}
        onRefreshRecommendCache={refresh}
      />,
    );

    await waitFor(() => expect(screen.getByText('推荐刷新失败，请稍后重试')).toBeInTheDocument());

    rerender(
      <RelatedNotesDrawer
        isOpen
        onClose={vi.fn()}
        selectedNoteId="note-1"
        allNotes={[{ ...note, updatedAt: '2026-08-19T00:00:04.000Z' }]}
        onRefreshRecommendCache={refresh}
      />,
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

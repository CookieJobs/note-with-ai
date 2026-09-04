import { render, screen } from '@testing-library/react';
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
  recommendCache: { sourceRevision: 4, byCandidateId: {} },
  revision: 4,
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('RelatedNotesDrawer relationship state', () => {
  it('waits for background relationship enrichment instead of repeatedly refreshing a same-revision legacy cache', () => {
    const refresh = vi.fn();
    render(
      <RelatedNotesDrawer
        isOpen
        onClose={vi.fn()}
        selectedNoteId="note-1"
        allNotes={[note]}
        onRefreshRecommendCache={refresh}
      />,
    );

    expect(screen.getByText('联系正在形成')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

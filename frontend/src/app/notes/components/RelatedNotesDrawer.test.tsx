import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Note } from '../hooks/useNotes';
import RelatedNotesDrawer from './RelatedNotesDrawer';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../utils/auth', () => ({ authFetch }));

const source: Note = {
  _id: 'source', title: '源笔记', content: '源内容', contentText: '源内容', contentJson: null,
  summary: '', concepts: [], keywords: [], revision: 4,
  recommendCache: { sourceRevision: 4, byCandidateId: { stale: { s2: 0.9 } } },
  enrichment: { sourceRevision: 4, status: 'ready' },
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
};

describe('RelatedNotesDrawer independent summaries', () => {
  it('reads related summaries independently and refreshes the read when the selected source revision changes', async () => {
    authFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { notes: [{ noteId: 'remote-1', title: '服务端关联', contentText: '独立读取结果', type: '强关联', reason: '同一主题', revision: 2 }] } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { notes: [] } }) });
    const { rerender } = render(
      <RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNoteId="source" allNotes={[source]} />,
    );

    await waitFor(() => expect(screen.getByText('服务端关联')).toBeInTheDocument());
    expect(authFetch).toHaveBeenCalledWith('/api/recommend/notes/source');

    rerender(
      <RelatedNotesDrawer
        isOpen
        onClose={vi.fn()}
        selectedNoteId="source"
        allNotes={[{ ...source, revision: 5, recommendCache: { sourceRevision: 5, byCandidateId: {} } }]}
      />,
    );

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
  });
});

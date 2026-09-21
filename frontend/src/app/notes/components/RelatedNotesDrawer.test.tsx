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

  it('explains a locally available relationship without exposing scoring internals while the summary request is pending', () => {
    authFetch.mockImplementation(() => new Promise(() => {}));
    const related: Note = {
      _id: 'local-related', title: '同一主题的笔记', content: '相关内容', contentText: '相关内容', contentJson: null,
      summary: '', concepts: [], keywords: [], revision: 2,
      enrichment: { sourceRevision: 2, status: 'ready' },
      createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    };
    const sourceWithReason: Note = {
      ...source,
      recommendCache: {
        sourceRevision: 4,
        byCandidateId: { 'local-related': { s1: 0.83, s2: 0.91, type: '强关联', reason: '两篇笔记都在讨论同一个项目目标。' } },
      },
    };

    render(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNoteId="source" allNotes={[sourceWithReason, related]} />);

    expect(screen.getByText('同一主题的笔记')).toBeInTheDocument();
    expect(screen.getByText('关联理由')).toBeInTheDocument();
    expect(screen.getByText('两篇笔记都在讨论同一个项目目标。')).toBeInTheDocument();
    expect(screen.queryByText('综合分')).not.toBeInTheDocument();
    expect(screen.queryByText('向量(s1)')).not.toBeInTheDocument();
    expect(screen.queryByText('模型(s2)')).not.toBeInTheDocument();
  });

  it('does not describe missing recommendations with score or threshold terminology', () => {
    authFetch.mockImplementation(() => new Promise(() => {}));
    const sourceWithoutCache: Note = { ...source, recommendCache: undefined };

    render(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNoteId="source" allNotes={[sourceWithoutCache]} />);

    expect(screen.getByText('正在计算相关推荐')).toBeInTheDocument();
    expect(screen.queryByText(/向量分数|强关联阈值/)).not.toBeInTheDocument();
  });

  it('does not turn a low-confidence cached candidate into a visible relationship', () => {
    authFetch.mockImplementation(() => new Promise(() => {}));
    const lowConfidenceTarget: Note = {
      _id: 'low-confidence', title: '不该展示的候选', content: '候选内容', contentText: '候选内容', contentJson: null,
      summary: '', concepts: [], keywords: [], revision: 1,
      enrichment: { sourceRevision: 1, status: 'ready' },
      createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    };
    const sourceWithLowConfidenceCache: Note = {
      ...source,
      recommendCache: {
        sourceRevision: 4,
        byCandidateId: { 'low-confidence': { s2: 0.4, type: '中等关联', reason: '不足以展示。' } },
      },
    };

    render(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNoteId="source" allNotes={[sourceWithLowConfidenceCache, lowConfidenceTarget]} />);

    expect(screen.getByText('暂无关联笔记')).toBeInTheDocument();
    expect(screen.queryByText('不该展示的候选')).not.toBeInTheDocument();
  });

  it('keeps the existing cached ranking while hiding the ranking diagnostics', () => {
    authFetch.mockImplementation(() => new Promise(() => {}));
    const lowerRanked: Note = {
      _id: 'lower-ranked', title: '原本排在后面的笔记', content: '后面的内容', contentText: '后面的内容', contentJson: null,
      summary: '', concepts: [], keywords: [], revision: 1,
      enrichment: { sourceRevision: 1, status: 'ready' },
      createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    };
    const higherRanked: Note = {
      ...lowerRanked, _id: 'higher-ranked', title: '原本排在前面的笔记', content: '前面的内容', contentText: '前面的内容',
    };
    const sourceWithRankedCache: Note = {
      ...source,
      recommendCache: {
        sourceRevision: 4,
        byCandidateId: {
          'lower-ranked': { s1: 0, s2: 0.9, type: '强关联', reason: '相关。' },
          'higher-ranked': { s1: 1, s2: 0.8, type: '强关联', reason: '更相关。' },
        },
      },
    };

    render(<RelatedNotesDrawer isOpen onClose={vi.fn()} selectedNoteId="source" allNotes={[sourceWithRankedCache, lowerRanked, higherRanked]} />);

    const higherRankedTitle = screen.getByText('原本排在前面的笔记');
    const lowerRankedTitle = screen.getByText('原本排在后面的笔记');
    expect(higherRankedTitle.compareDocumentPosition(lowerRankedTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

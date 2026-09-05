import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MemoryPage from './page';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div /> }));
vi.mock('../../services/memoryService', () => ({
  getMemoryInsights: mockGet,
  confirmMemoryInsight: vi.fn(),
  correctMemoryInsight: vi.fn(),
  deleteMemoryInsight: vi.fn(),
}));

describe('MemoryPage', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue([{
      id: 'memory-1', displayStatement: '你在练习写作', status: 'proposed', confidence: 'tentative',
      evidence: [{ noteId: 'note-1', noteRevision: 2, excerpt: '我想持续练习写作', capturedAt: '2026-09-01T00:00:00.000Z' }],
    }]);
  });

  it('reveals an evidence link and asks for deletion confirmation', async () => {
    render(<MemoryPage />);
    expect(await screen.findByText('你在练习写作')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看依据' }));
    expect(screen.getByRole('link', { name: '查看原文' })).toHaveAttribute('href', '/notes?highlight=note-1');
    fireEvent.click(screen.getByRole('button', { name: '删除这条记忆' }));
    expect(screen.getByRole('dialog', { name: '删除这条记忆' })).toBeInTheDocument();
  });
});

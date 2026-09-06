import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MemoryPage from './page';

const { mockGenerate, mockGet } = vi.hoisted(() => ({ mockGenerate: vi.fn(), mockGet: vi.fn() }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div /> }));
vi.mock('../../services/memoryService', () => ({
  getMemoryInsights: mockGet,
  generateMemoryInsights: mockGenerate,
  confirmMemoryInsight: vi.fn(),
  correctMemoryInsight: vi.fn(),
  deleteMemoryInsight: vi.fn(),
}));

describe('MemoryPage', () => {
  beforeEach(() => {
    mockGenerate.mockResolvedValue({ created: 0 });
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

  it('explains when memory generation cannot complete instead of failing silently', async () => {
    mockGet.mockResolvedValue([]);
    mockGenerate.mockRejectedValue(new Error('request failed'));

    render(<MemoryPage />);
    fireEvent.click(await screen.findByRole('button', { name: '从我的笔记整理记忆' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法整理记忆，请稍后再试。');
  });
});

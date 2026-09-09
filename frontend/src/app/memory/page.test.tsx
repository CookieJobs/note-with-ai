import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemoryPage from './page';

const { mockConfirm, mockCorrect, mockDelete, mockGenerate, mockGet } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockCorrect: vi.fn(),
  mockDelete: vi.fn(),
  mockGenerate: vi.fn(),
  mockGet: vi.fn(),
}));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div /> }));
vi.mock('../../services/memoryService', () => ({
  getMemoryInsights: mockGet,
  generateMemoryInsights: mockGenerate,
  confirmMemoryInsight: mockConfirm,
  correctMemoryInsight: mockCorrect,
  deleteMemoryInsight: mockDelete,
}));

describe('MemoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('presents confirmation with the shared primary action treatment', async () => {
    render(<MemoryPage />);

    const confirm = await screen.findByRole('button', { name: '这是准确的' });

    expect(confirm).toHaveClass('bg-primary');
  });

  it('opens the edit form as a labelled modal', async () => {
    render(<MemoryPage />);

    fireEvent.click(await screen.findByRole('button', { name: '修改' }));

    const dialog = await screen.findByRole('dialog', { name: '用你的话重新表述' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('closes the edit modal with Escape without saving and returns focus to its trigger', async () => {
    render(<MemoryPage />);

    const edit = await screen.findByRole('button', { name: '修改' });
    fireEvent.click(edit);
    fireEvent.keyDown(await screen.findByRole('dialog', { name: '用你的话重新表述' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockCorrect).not.toHaveBeenCalled();
    expect(edit).toHaveFocus();
  });

  it('closes the deletion modal with Escape without deleting the memory', async () => {
    render(<MemoryPage />);

    fireEvent.click(await screen.findByRole('button', { name: '删除这条记忆' }));
    fireEvent.keyDown(await screen.findByRole('dialog', { name: '删除这条记忆' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('explains when memory generation cannot complete instead of failing silently', async () => {
    mockGet.mockResolvedValue([]);
    mockGenerate.mockRejectedValue(new Error('request failed'));

    render(<MemoryPage />);
    fireEvent.click(await screen.findByRole('button', { name: '从我的笔记整理记忆' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法整理记忆，请稍后再试。');
  });
});

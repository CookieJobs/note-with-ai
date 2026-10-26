import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CareAssistantPanel from './CareAssistantPanel';

const { authFetch, push } = vi.hoisted(() => ({ authFetch: vi.fn(), push: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('care source reference', () => {
  beforeEach(() => { authFetch.mockReset(); push.mockReset(); sessionStorage.clear(); });

  it('uses a generic CTA when the server returns no source note', async () => {
    authFetch.mockResolvedValue({ json: async () => ({ data: { noteId: null, aiOpening: '先聊聊最近的想法。' } }) });
    const onSend = vi.fn();
    render(<CareAssistantPanel onInsert={vi.fn()} onSend={onSend} cacheKey="no-note" />);
    fireEvent.click(await screen.findByRole('button', { name: '开始聊天' }));
    expect(screen.queryByText('从你的笔记继续')).toBeNull();
    expect(screen.queryByRole('button', { name: '从这条笔记聊起' })).toBeNull();
    expect(onSend).toHaveBeenCalledWith('先聊聊最近的想法。', expect.objectContaining({ noteId: null }));
  });

  it('uses a generic CTA after a recommendation failure', async () => {
    authFetch.mockRejectedValue(new Error('offline'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<CareAssistantPanel onInsert={vi.fn()} onSend={vi.fn()} cacheKey="failed-intro" />);
      expect(await screen.findByRole('button', { name: '开始聊天' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '从这条笔记聊起' })).toBeNull();
    } finally { error.mockRestore(); }
  });

  it('links an untitled source by note ID and shows its verified source date', async () => {
    authFetch.mockResolvedValue({ json: async () => ({ data: {
      noteId: '507f1f77bcf86cd799439011', noteTitle: '', snippet: '原文片段', excerpt: '原文第一行',
      createdAt: '2026-10-12T16:30:00.000Z', createdAtSource: 'note', aiOpening: '最近如何？',
    } }) });
    render(<CareAssistantPanel onInsert={vi.fn()} onSend={vi.fn()} cacheKey="test-care-source" />);
    const link = await screen.findByRole('button', { name: /原文第一行.*2026\/10\/13 00:30/ });
    expect(screen.getByRole('button', { name: '从这条笔记聊起' })).toBeInTheDocument();
    link.click();
    expect(push).toHaveBeenCalledWith('/notes?highlight=507f1f77bcf86cd799439011');
  });

  it('keeps a legacy ID-only cached source openable without claiming an old date', async () => {
    sessionStorage.setItem('test-old-care', JSON.stringify({ noteId: '507f1f77bcf86cd799439011', noteTitle: '', snippet: '', aiOpening: '最近如何？' }));
    render(<CareAssistantPanel onInsert={vi.fn()} onSend={vi.fn()} cacheKey="test-old-care" />);
    await waitFor(() => expect(screen.getByRole('button', { name: '查看原笔记' })).toBeInTheDocument());
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('waits for source validation before accepting another entry click', async () => {
    sessionStorage.setItem('pending-care', JSON.stringify({ noteId: 'note-1', noteTitle: '学习', snippet: '20分钟', aiOpening: '聊聊学习。' }));
    let finish!: () => void;
    const onSend = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<CareAssistantPanel onInsert={vi.fn()} onSend={onSend} cacheKey="pending-care" />);
    const start = await screen.findByRole('button', { name: '从这条笔记聊起' });
    fireEvent.click(start);
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(start).not.toBeDisabled();
  });
});

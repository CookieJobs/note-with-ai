import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RelationshipCard from './RelationshipCard';
import type { NoteRelationship } from '../types/relationships';

const relationship: NoteRelationship = {
  relationshipId: 'relationship:note-a:3:note-b:1',
  source: { noteId: 'note-a', revision: 3, excerpt: '给新功能留出观察期', occurredAt: '2026-03-01T10:00:00.000Z' },
  candidate: { noteId: 'note-b', revision: 1, excerpt: '先留出观察期，再决定是否继续投入', occurredAt: '2026-02-20T10:00:00.000Z' },
  kind: 'continuation', headline: '两条记录都在等待观察期后的决定', explanation: '它们都提到先观察新功能，再决定下一步。', confidence: 'supported', generatedAt: '2026-03-02T00:00:00.000Z',
};

describe('RelationshipCard', () => {
  it('shows two attributed excerpts and exposes feedback and continuation actions', () => {
    const onFeedback = vi.fn();
    const onContinueWriting = vi.fn();
    const onStartChat = vi.fn();
    render(<RelationshipCard relationship={relationship} onFeedback={onFeedback} onContinueWriting={onContinueWriting} onStartChat={onStartChat} onOpenSource={vi.fn()} />);

    expect(screen.getByText('给新功能留出观察期')).toBeInTheDocument();
    expect(screen.getByText('先留出观察期，再决定是否继续投入')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '有帮助' }));
    fireEvent.click(screen.getByRole('button', { name: '继续写' }));
    fireEvent.click(screen.getByRole('button', { name: '和 AI 聊聊' }));
    expect(onFeedback).toHaveBeenCalledWith('helpful');
    expect(onContinueWriting).toHaveBeenCalledWith(relationship);
    expect(onStartChat).toHaveBeenCalledWith(relationship);
  });

  it('does not leave feedback selected when saving the feedback fails', async () => {
    const onFeedback = vi.fn().mockRejectedValue(new Error('反馈暂时无法保存'));
    render(<RelationshipCard relationship={relationship} onFeedback={onFeedback} onContinueWriting={vi.fn()} onStartChat={vi.fn()} onOpenSource={vi.fn()} />);

    const button = screen.getByRole('button', { name: '有帮助' });
    fireEvent.click(button);
    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith('helpful'));
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});

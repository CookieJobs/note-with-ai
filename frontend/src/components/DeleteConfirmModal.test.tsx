import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DeleteConfirmModal from './DeleteConfirmModal';

describe('chat deletion confirmation', () => {
  it('waits for deletion, blocks repeated confirmation and preserves a failed dialog for retry', async () => {
    let reject!: (failure: Error) => void;
    const onCancel = vi.fn();
    const onConfirm = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
    render(<DeleteConfirmModal show onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledOnce();
    await act(async () => { reject(new Error('删除失败，请重试')); });
    expect(screen.getByRole('alert')).toHaveTextContent('删除失败，请重试');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
  it('focuses the dialog and lets Escape cancel without deleting', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmModal show onCancel={onCancel} onConfirm={onConfirm} />,
    );
    expect(screen.getByRole('dialog', { name: '确认删除会话' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

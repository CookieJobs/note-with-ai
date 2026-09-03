import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ReasonDialog from './ReasonDialog';

describe('ReasonDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts only a trimmed 5–200 character reason', () => {
    render(<ReasonDialog onClose={vi.fn()} onSubmit={vi.fn()} />);
    const reason = screen.getByLabelText('原因');
    const confirm = screen.getByRole('button', { name: '确认' });

    fireEvent.change(reason, { target: { value: '四字' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: '  五个中文字  ' } });
    expect(confirm).toBeEnabled();
    fireEvent.change(reason, { target: { value: 'x'.repeat(200) } });
    expect(confirm).toBeEnabled();
    fireEvent.change(reason, { target: { value: 'x'.repeat(201) } });
    expect(confirm).toBeDisabled();
  });

  it('shows pending, ignores Escape while pending, and closes once afterward', async () => {
    let resolveSubmit!: () => void;
    const close = vi.fn();
    const submit = vi.fn(() => new Promise<void>((resolve) => { resolveSubmit = resolve; }));
    render(<ReasonDialog onClose={close} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '需要执行操作' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();

    resolveSubmit();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认' })).toBeEnabled());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retains a rejected mutation error and allows retry', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('服务暂不可用'))
      .mockResolvedValueOnce(undefined);
    render(<ReasonDialog onClose={vi.fn()} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '需要执行操作' } });

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂不可用');
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  });

  it('contains keyboard focus and restores focus when unmounted', () => {
    const opener = document.createElement('button');
    opener.textContent = '打开';
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<ReasonDialog onClose={vi.fn()} onSubmit={vi.fn()} />);
    const textarea = screen.getByLabelText('原因');
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(textarea).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(textarea).toHaveFocus();
    textarea.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

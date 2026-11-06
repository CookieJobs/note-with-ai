import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatNotePreview from './ChatNotePreview';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch }));
const reply = (id: string, content = '最新保存的正文') => ({ ok: true, status: 200, json: async () => ({ success: true, data: { note: { _id: id, title: '原始标题', content, revision: 1 } } }) });
const props = () => ({ userId: 'u1', noteId: 'n1', panelRef: createRef<HTMLDivElement>(), isModal: false, onClose: vi.fn(), onOpenFull: vi.fn() });

describe('chat note preview', () => {
  beforeEach(() => authFetch.mockReset());

  it('reads the canonical full note rather than showing a chat excerpt and keeps only two toolbar actions', async () => {
    authFetch.mockResolvedValue(reply('n1'));
    const p = props(); render(<ChatNotePreview {...p} />);
    expect(await screen.findByText('最新保存的正文')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '原始标题' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '打开完整笔记' }));
    expect(p.onOpenFull).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '关闭笔记' }));
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it('shows a deleted note without substituting old content', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 404 });
    render(<ChatNotePreview {...props()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('笔记已删除'));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('retries a failed read without closing the panel', async () => {
    authFetch.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(reply('n1'));
    render(<ChatNotePreview {...props()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取笔记');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('最新保存的正文')).toBeInTheDocument();
  });

  it('ignores an old note response after switching the preview', async () => {
    let resolve!: (value: unknown) => void;
    authFetch.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce(reply('n2', '第二篇正文'));
    const p = props(); const view = render(<ChatNotePreview {...p} />);
    view.rerender(<ChatNotePreview {...p} noteId="n2" />);
    expect(await screen.findByText('第二篇正文')).toBeInTheDocument();
    await act(async () => resolve(reply('n1', '过期的第一篇正文')));
    expect(screen.queryByText('过期的第一篇正文')).not.toBeInTheDocument();
    expect(screen.getByText('第二篇正文')).toBeInTheDocument();
  });
});

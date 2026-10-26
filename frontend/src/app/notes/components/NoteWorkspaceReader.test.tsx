import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Note } from '../hooks/useNotes';
import NoteWorkspaceReader from './NoteWorkspaceReader';

const note = { _id: 'n1', title: '', content: '无标题的真实正文', contentText: '无标题的真实正文', contentJson: null, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', revision: 1 } as Note;

describe('NoteWorkspaceReader', () => {
  it('leads with prose without adding an artificial untitled heading', () => {
    render(<NoteWorkspaceReader note={note} onEdit={vi.fn()} onDelete={vi.fn()} onRelated={vi.fn()} relatedOpen={false} />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('无标题的真实正文')).toBeInTheDocument();
    expect(screen.queryByText('无标题笔记')).toBeNull();
  });

  it('renders a real rich document and keeps reading actions explicit', async () => {
    const onEdit = vi.fn(), onDelete = vi.fn(), onRelated = vi.fn();
    render(<NoteWorkspaceReader note={{ ...note, title: '标题', contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '格式正文', marks: [{ type: 'bold' }] }] }] } }} onEdit={onEdit} onDelete={onDelete} onRelated={onRelated} relatedOpen />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('标题');
    expect((await screen.findByText('格式正文')).closest('strong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '相关笔记' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '编辑笔记' })); expect(onEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '相关笔记' })); expect(onRelated).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '更多笔记操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除笔记' })); expect(onDelete).toHaveBeenCalledOnce();
  });

  it('keeps legacy Markdown formatting through the existing viewer string path', async () => {
    render(<NoteWorkspaceReader note={{ ...note, contentText: '', content: '## 历史标题\n\n**强调正文**' }} onEdit={vi.fn()} onDelete={vi.fn()} onRelated={vi.fn()} relatedOpen={false} />);
    expect(await screen.findByRole('heading', { level: 2, name: '历史标题' })).toBeInTheDocument();
    expect(screen.getByText('强调正文').closest('strong')).toBeInTheDocument();
    expect(screen.queryByText('**强调正文**')).toBeNull();
  });

  it('retains plain-text line breaks in the same viewer', async () => {
    const { container } = render(<NoteWorkspaceReader note={{ ...note, contentText: '第一行\n第二行', content: '第一行\n第二行' }} onEdit={vi.fn()} onDelete={vi.fn()} onRelated={vi.fn()} relatedOpen={false} />);
    await screen.findByText(/第一行/);
    const prose = container.querySelector('.ProseMirror');
    expect(Boolean(prose?.textContent?.includes('\n') || prose?.querySelector('br') || (prose?.querySelectorAll('p').length ?? 0) > 1)).toBe(true);
  });

  it('preserves legacy indented code blocks even when a plain text projection is present', async () => {
    const { container } = render(<NoteWorkspaceReader note={{ ...note, content: '代码示例\n\n    const existing = 1;', contentText: '代码示例\nconst existing = 1;' }} onEdit={vi.fn()} onDelete={vi.fn()} onRelated={vi.fn()} relatedOpen={false} />);
    await waitFor(() => expect(container.querySelector('pre code')).toHaveTextContent('const existing = 1;'));
  });
  it('preserves legacy reference links rather than showing their Markdown syntax', async () => {
    render(<NoteWorkspaceReader note={{ ...note, contentText: '', content: '[阅读资料][ref]\n\n[ref]: https://example.com/research' }} onEdit={vi.fn()} onDelete={vi.fn()} onRelated={vi.fn()} relatedOpen={false} />);
    expect(await screen.findByRole('link', { name: '阅读资料' })).toHaveAttribute('href', 'https://example.com/research');
  });
  it('preserves legacy Setext headings', async () => {
    render(<NoteWorkspaceReader note={{ ...note, contentText: '', content: '历史标题\n===\n\n历史正文' }} onEdit={vi.fn()} onDelete={vi.fn()} onRelated={vi.fn()} relatedOpen={false} />);
    expect(await screen.findByRole('heading', { level: 1, name: '历史标题' })).toBeInTheDocument();
  });
});

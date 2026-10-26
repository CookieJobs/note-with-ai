import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingQuickCompose from './FloatingQuickCompose';

const { suggestNoteTitle } = vi.hoisted(() => ({ suggestNoteTitle: vi.fn() }));
vi.mock('../../../services/noteTitleSuggestions', () => ({ suggestNoteTitle }));

const props = {
  valueJson: null, valueText: '想记录的正文', title: '', userId: 'user-1',
  onTitleChange: vi.fn(), onOpen: vi.fn(), onChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
};

describe('quick compose title disclosure', () => {
  beforeEach(() => { suggestNoteTitle.mockReset(); });

  it('reveals the title button only after usable body text and hides it again when the body is cleared', () => {
    const { rerender } = render(<FloatingQuickCompose {...props} open valueText="   " />);
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '帮我拟个标题' })).toBeNull();

    rerender(<FloatingQuickCompose {...props} open valueText="今天记下的想法" />);
    expect(screen.getByRole('button', { name: '帮我拟个标题' })).toBeEnabled();
    expect(suggestNoteTitle).not.toHaveBeenCalled();

    rerender(<FloatingQuickCompose {...props} open valueText="" />);
    expect(screen.queryByRole('button', { name: '帮我拟个标题' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toBeInTheDocument();
  });

  it('returns focus to the capture entry after explicitly canceling', async () => {
    function Composer() {
      const [open, setOpen] = useState(false);
      return <FloatingQuickCompose {...props} open={open} onOpen={() => setOpen(true)} onCancel={() => setOpen(false)} />;
    }
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '打开快速记录' }));
    const cancel = await screen.findByRole('button', { name: '取消' });
    cancel.focus();
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.getByRole('button', { name: '打开快速记录' })).toHaveFocus());
  });

  it('shows the optional title field and AI only after opening the composer', async () => {
    const { rerender } = render(<FloatingQuickCompose {...props} open={false} />);
    expect(screen.queryByRole('textbox', { name: '笔记标题' })).toBeNull();
    expect(screen.queryByText('帮我拟个标题')).toBeNull();

    rerender(<FloatingQuickCompose {...props} open />);
    const title = await screen.findByRole('textbox', { name: '笔记标题' });
    expect(title).toHaveValue('');
    expect(title).not.toBeRequired();
    expect(screen.getByRole('button', { name: '帮我拟个标题' })).toBeInTheDocument();
    expect(screen.queryByText('添加标题')).toBeNull();
    fireEvent.blur(title, { relatedTarget: screen.getByRole('button', { name: '保存' }) });
    expect(title).toBeInTheDocument();
  });

  it('lets a new note keep or undo a generated title without submitting it', async () => {
    suggestNoteTitle.mockResolvedValue({ title: '新笔记建议' });
    const onSubmit = vi.fn();
    function Composer() {
      const [title, setTitle] = useState('');
      return <FloatingQuickCompose {...props} open title={title} onTitleChange={setTitle} onSubmit={onSubmit} />;
    }
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '帮我拟个标题' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('新笔记建议'));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '撤销生成' }));
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveValue('');
  });

  it('hides AI for an image-only draft even when the editor emits Markdown image text', () => {
    render(<FloatingQuickCompose {...props} open valueText="![照片](/note-image.jpg)" valueJson={{
      type: 'doc', content: [{ type: 'image', attrs: { src: '/note-image.jpg', alt: '照片' } }],
    }} />);
    expect(screen.queryByRole('button', { name: '帮我拟个标题' })).toBeNull();
  });
});

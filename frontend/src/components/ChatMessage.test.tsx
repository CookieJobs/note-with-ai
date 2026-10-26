import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChatMessage from './ChatMessage';

describe('ChatMessage Markdown tables', () => {
  it('identifies an ordinary assistant answer without claiming it is note evidence', () => {
    render(<ChatMessage role="assistant" content="普通回答" />);
    expect(screen.getByText('NoteWithAI')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '本次回答依据' })).not.toBeInTheDocument();
  });
  it('renders GFM table content as a semantic table', () => {
    render(
      <ChatMessage
        role="assistant"
        content={'| 名称 | 数量 |\n| --- | ---: |\n| 笔记 | 3 |'}
      />
    );

    const table = screen.getByRole('table');
    expect(screen.getByRole('region', { name: '可横向滚动的表格' })).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument();
  });
});

describe('ChatMessage answer sources', () => {
  const sourceSnapshot = {
    noteId: 'note/学习 + 7',
    title: '学习安排更新',
    contentText: '周三 20 分钟。\n\n**保留原样** <script>不能执行</script>\n不购买工具。',
    revision: 7,
    updatedAt: '2026-10-17T12:34:56.789Z',
    hasImages: true,
  };

  it('lets readers inspect the exact text and version used for an assistant answer', () => {
    render(<ChatMessage role="assistant" content="可以按周三的安排继续。" sourceSnapshot={sourceSnapshot} />);

    const basis = screen.getByRole('region', { name: '本次回答依据' });
    expect(within(basis).getByRole('link', { name: '学习安排更新' })).toHaveAttribute(
      'href',
      '/notes?highlight=note%2F%E5%AD%A6%E4%B9%A0%20%2B%207',
    );
    expect(within(basis).getByText('版本 7')).toBeInTheDocument();
    expect(within(basis).getByText('2026/10/17 20:34:56.789（UTC+08:00）')).toHaveAttribute(
      'datetime',
      '2026-10-17T12:34:56.789Z',
    );
    expect(within(basis).getByText('仅使用文字内容，图片尚未识别。')).toBeInTheDocument();
    expect(within(basis).getByRole('region', { name: '本次使用的笔记原文' })).not.toBeVisible();

    fireEvent.click(within(basis).getByText('查看本次使用的笔记原文'));

    const originalText = within(basis).getByRole('region', { name: '本次使用的笔记原文' });
    expect(originalText).toBeVisible();
    expect(originalText.textContent).toBe('周三 20 分钟。\n\n**保留原样** <script>不能执行</script>\n不购买工具。');
    expect(originalText.querySelector('strong, script')).toBeNull();
  });

  it('retains the saved snapshot when the discussion note changes', () => {
    const { rerender } = render(
      <ChatMessage role="assistant" content="旧回答" sourceSnapshot={sourceSnapshot} />,
    );

    rerender(
      <ChatMessage
        role="assistant"
        content="旧回答"
        sourceSnapshot={sourceSnapshot}
        relatedNotes={[{ noteId: sourceSnapshot.noteId, title: '刚编辑的新标题', content: '周三改成 60 分钟。' }]}
      />,
    );
    const basis = screen.getByRole('region', { name: '本次回答依据' });
    fireEvent.click(within(basis).getByText('查看本次使用的笔记原文'));

    expect(within(basis).getByRole('link', { name: '学习安排更新' })).toBeInTheDocument();
    expect(within(basis).getByRole('region', { name: '本次使用的笔记原文' }).textContent).toBe(sourceSnapshot.contentText);
    expect(within(basis).queryByText('周三改成 60 分钟。')).not.toBeInTheDocument();
  });

  it('keeps a legacy care opener as a discussion note without claiming answer evidence', () => {
    render(
      <ChatMessage
        role="assistant"
        content="我们可以从这篇笔记聊起。"
        relatedNotes={[{ noteId: 'legacy care', title: '旧开场笔记', matchType: 'care_source' }]}
      />,
    );

    expect(screen.getByRole('region', { name: '笔记原文' })).toBeInTheDocument();
    expect(screen.getByText('AI 开场提问')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看完整笔记/ })).toHaveAttribute('href', '/notes?highlight=legacy%20care');
    expect(screen.queryByRole('region', { name: '本次回答依据' })).not.toBeInTheDocument();
    expect(screen.queryByText('查看本次使用的笔记原文')).not.toBeInTheDocument();
  });

  it('separates the note excerpt from the AI opening and lets readers expand only the excerpt', () => {
    const excerpt = '当时的记录。'.repeat(40) + '这是摘录末尾。';
    render(<ChatMessage role="assistant" content="现在你怎么看？" relatedNotes={[{
      noteId: 'long-note', title: '回看过去', excerpt, matchType: 'care_source',
      createdAt: '2024-08-11T09:17:00Z', createdAtSource: 'note',
    }]} />);

    const original = screen.getByRole('region', { name: '笔记原文' });
    const opening = screen.getByRole('region', { name: 'AI 开场提问' });
    expect(original.compareDocumentPosition(opening) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(original).queryByText('现在你怎么看？')).not.toBeInTheDocument();
    expect(within(opening).getByText('现在你怎么看？')).toBeInTheDocument();
    expect(original).not.toHaveTextContent('这是摘录末尾。');
    expect(within(original).getByText('2024/08/11 17:17')).toBeInTheDocument();

    const toggle = within(original).getByRole('button', { name: '展开摘录' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(original).toHaveTextContent(excerpt);
    expect(within(original).getByRole('button', { name: '收起摘录' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(original).getByRole('button', { name: '收起摘录' }));
    expect(original).not.toHaveTextContent('这是摘录末尾。');
  });

  it('keeps untitled, short source text intact without inventing a title or an expand action', () => {
    render(<ChatMessage role="assistant" content="今天有什么新想法？" relatedNotes={[{
      noteId: 'untitled', title: '', content: '第一行\n\n**原样保留** <script>不可执行</script>', matchType: 'care_source',
    }]} />);
    const original = screen.getByRole('region', { name: '笔记原文' });
    expect(within(original).queryByRole('heading')).not.toBeInTheDocument();
    expect(original.querySelector('blockquote')?.textContent).toBe('第一行\n\n**原样保留** <script>不可执行</script>');
    expect(original.querySelector('script, strong')).toBeNull();
    expect(within(original).queryByRole('button', { name: '展开摘录' })).not.toBeInTheDocument();
  });

  it('never presents source metadata on a user message', () => {
    render(
      <ChatMessage
        role="user"
        content="下周怎么安排？"
        sourceSnapshot={sourceSnapshot}
        relatedNotes={[{ noteId: 'legacy care', title: '旧开场笔记' }]}
      />,
    );

    expect(screen.getByText('下周怎么安排？')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '本次回答依据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

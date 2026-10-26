import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChatHistoryPanel from './ChatHistoryPanel';

const sessions = [
  { id: 'one', title: '膝盖健康咨询', messages: [] },
  { id: 'two', title: '产品设计复盘', messages: [] },
];

const props = {
  sessions,
  currentSessionId: 'one',
  isClient: true,
  isOpen: false,
  onClose: vi.fn(),
  onSessionSelect: vi.fn(),
  onNewSession: vi.fn(),
  onDeleteSession: vi.fn(),
};

describe('chat history workspace', () => {
  it('embeds real search and history without a second new-chat or close toolbar', () => {
    render(<ChatHistoryPanel {...props} embedded />);
    expect(screen.queryByRole('button', { name: '开启新对话' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭聊天侧栏' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '产品' } });
    expect(screen.getByRole('button', { name: '产品设计复盘' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '膝盖健康咨询' })).not.toBeInTheDocument();
  });
  it('finds a generic conversation by its discussed source and uses a distinct label without selecting it', () => {
    const onSessionSelect = vi.fn();
    render(<ChatHistoryPanel {...props} onSessionSelect={onSessionSelect} sessions={[
      { id: 'source-chat', title: '新对话', messages: [{ role: 'assistant', content: '聊聊界面设计', relatedNotes: [{ noteId: 'note-one', title: '飞书日历时间设置优化建议', matchType: 'care_source' }] }] },
      { id: 'another', title: '新对话', messages: [{ role: 'user', content: '周末骑车的想法' }] },
    ]} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '飞书' } });
    expect(screen.getByRole('button', { name: '飞书日历时间设置优化建议' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除对话：飞书日历时间设置优化建议' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除对话：飞书日历时间设置优化建议' })).toHaveAttribute('title', '删除对话：飞书日历时间设置优化建议');
    expect(screen.queryByRole('button', { name: '周末骑车的想法' })).toBeNull();
    expect(onSessionSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '周末骑车的想法' })).toBeInTheDocument();
  });
  it('filters conversation titles without changing the selected conversation', () => {
    render(<ChatHistoryPanel {...props} />);
    expect(screen.getByRole('searchbox', { name: '搜索聊天' })).toHaveAttribute('placeholder', '搜索已加载的对话');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索聊天' }), {
      target: { value: '产品' },
    });
    expect(
      screen.getByRole('button', { name: '产品设计复盘' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '膝盖健康咨询' }),
    ).not.toBeInTheDocument();
    expect(props.onSessionSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '膝盖健康咨询' }));
    expect(props.onSessionSelect).toHaveBeenCalledWith('one');
  });

  it('collapses history and allows it to be restored', () => {
    render(<ChatHistoryPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '收起聊天侧栏' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开聊天侧栏' }));
    expect(
      screen.getByRole('searchbox', { name: '搜索聊天' }),
    ).toBeInTheDocument();
  });

  it('closes the history panel before opening deletion confirmation', () => {
    const steps: string[] = [];
    render(
      <ChatHistoryPanel
        {...props}
        isOpen
        onClose={() => steps.push('close')}
        onDeleteSession={() => steps.push('confirm')}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: '删除对话：膝盖健康咨询' }),
    );
    expect(steps).toEqual(['close', 'confirm']);
  });
});

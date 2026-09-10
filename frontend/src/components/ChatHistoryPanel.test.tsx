import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatHistoryPanel from './ChatHistoryPanel';
import ChatInputArea from './ChatInputArea';

const sessions = [
  {
    id: 'session-1',
    title: '旅行计划',
    messages: [],
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  },
];

function setViewport(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: isDesktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderHistory({ isOpen = false, onClose = vi.fn() } = {}) {
  return {
    onClose,
    ...render(
      <ChatHistoryPanel
        sessions={sessions}
        currentSessionId="session-1"
        isClient
        isOpen={isOpen}
        onClose={onClose}
        onSessionSelect={vi.fn()}
        onNewSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    ),
  };
}

describe('ChatHistoryPanel', () => {
  beforeEach(() => {
    setViewport(false);
  });

  it('keeps closed mobile history out of accessibility queries', () => {
    renderHistory();

    expect(screen.queryByRole('dialog', { name: '聊天记录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开启新对话' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '旅行计划' })).not.toBeInTheDocument();
  });

  it('keeps the history visible as a persistent sidebar on desktop', async () => {
    setViewport(true);
    renderHistory();

    expect(await screen.findByRole('complementary', { name: '聊天记录' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '聊天记录' })).not.toBeInTheDocument();
  });

  it('closes the mobile drawer with Escape', async () => {
    const onClose = vi.fn();
    renderHistory({ isOpen: true, onClose });

    const drawer = await screen.findByRole('dialog', { name: '聊天记录' });
    fireEvent.keyDown(drawer, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('uses separately named buttons for selecting and deleting a session', async () => {
    renderHistory({ isOpen: true });

    expect(await screen.findByRole('button', { name: '旅行计划' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除对话：旅行计划' })).toBeInTheDocument();
  });

  it('keeps the composer controls named and at the 44px target size', () => {
    render(
      <ChatInputArea
        input=""
        loading={false}
        error=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: '发送消息' })).toHaveClass('min-h-11', 'min-w-11');
  });
});

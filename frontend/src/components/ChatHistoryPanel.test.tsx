import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatHistoryPanel from './ChatHistoryPanel';
import ChatInputArea from './ChatInputArea';

const chatStyles = readFileSync(join(process.cwd(), 'src/app/chat/chat.module.scss'), 'utf8');
const chatInputSource = readFileSync(join(process.cwd(), 'src/components/ChatInputArea.tsx'), 'utf8');
const semanticTokens = readFileSync(join(process.cwd(), 'src/styles/_variables.scss'), 'utf8');

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

function semanticBlock(selector: ':root' | '.dark') {
  const start = semanticTokens.indexOf(`${selector} {`);
  const end = semanticTokens.indexOf('\n}', start);

  return semanticTokens.slice(start, end);
}

function hexToken(block: string, token: string) {
  const value = block.match(new RegExp(`${token}:\\s*(#[\\da-f]{6});`, 'i'))?.[1];

  if (!value) throw new Error(`Missing hexadecimal ${token}`);

  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ] as const;
}

function contrastRatio(first: readonly number[], second: readonly number[]) {
  const luminance = (color: readonly number[]) =>
    color.reduce((total, channel, index) => {
      const normalized = channel / 255;
      const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;

      return total + [0.2126, 0.7152, 0.0722][index] * linear;
    }, 0);
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

function DrawerFocusHarness() {
  const [isOpen, setIsOpen] = useState(true);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={menuButtonRef} type="button">打开侧边栏</button>
      <ChatHistoryPanel
        sessions={sessions}
        currentSessionId="session-1"
        isClient
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSessionSelect={vi.fn()}
        onNewSession={vi.fn()}
        onDeleteSession={vi.fn()}
        menuButtonRef={menuButtonRef}
      />
    </>
  );
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

  it('returns focus to the sidebar trigger after mobile drawer dismissal', async () => {
    render(<DrawerFocusHarness />);

    const drawer = await screen.findByRole('dialog', { name: '聊天记录' });
    fireEvent.keyDown(drawer, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '聊天记录' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '打开侧边栏' })).toHaveFocus();
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

  it('keeps disclaimer contrast above 4.5:1 on token-backed chat surfaces in light and dark modes', () => {
    expect(chatStyles).toMatch(/\.container\s*\{[^}]*background:\s*var\(--color-surface-page\)/);
    expect(chatStyles).toMatch(/\.emptyContainer\s*\{[^}]*var\(--color-surface-page\)[^}]*var\(--color-surface-sunken\)/);
    expect(chatStyles).toMatch(/\.disclaimer\s*\{[^}]*color:\s*var\(--color-text-secondary\)/);

    for (const selector of [':root', '.dark'] as const) {
      const tokens = semanticBlock(selector);
      expect(
        contrastRatio(
          hexToken(tokens, '--color-text-secondary'),
          hexToken(tokens, '--color-surface-page'),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses enumerated composer motion with a reduced-motion fallback', () => {
    expect(chatInputSource).not.toMatch(/\btransition-all\b/);
    expect(chatStyles).not.toMatch(/transition\s*:\s*all\b/);
    expect(chatStyles).toMatch(/transition:\s*border-color[^;]+box-shadow/);
    expect(chatStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});

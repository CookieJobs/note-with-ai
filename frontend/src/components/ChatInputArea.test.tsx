import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChatInputArea from './ChatInputArea';

function setup(input = '完整消息', loading = false) {
  const onSend = vi.fn();
  render(
    <ChatInputArea
      input={input}
      loading={loading}
      error=""
      onInputChange={vi.fn()}
      onSend={onSend}
    />,
  );
  return { onSend, textbox: screen.getByRole('textbox', { name: '聊天消息' }) };
}

describe('chat keyboard sending', () => {
  it('places free-form writing before an optional suggested conversation in keyboard order', () => {
    render(<ChatInputArea input="" loading={false} error="" onInputChange={vi.fn()} onSend={vi.fn()} centered
      suggestionComponent={<button type="button">从笔记聊起</button>} />);
    const composer = screen.getByRole('textbox', { name: '聊天消息' });
    const suggestion = screen.getByRole('button', { name: '从笔记聊起' });
    expect(composer.compareDocumentPosition(suggestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([{ isComposing: true }, { isComposing: false, keyCode: 229 }])(
    'leaves IME confirmation alone: %o',
    (composition) => {
      const { onSend, textbox } = setup();
      expect(fireEvent.keyDown(textbox, { key: 'Enter', ...composition })).toBe(
        true,
      );
      expect(onSend).not.toHaveBeenCalled();
    },
  );

  it('sends once on a normal Enter', () => {
    const { onSend, textbox } = setup();
    expect(fireEvent.keyDown(textbox, { key: 'Enter' })).toBe(false);
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('preserves Shift+Enter for a newline', () => {
    const { onSend, textbox } = setup();
    expect(fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true })).toBe(
      true,
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([
    ['   ', false],
    ['消息', true],
  ] as const)('does not submit input %s while loading=%s', (input, loading) => {
    const { onSend, textbox } = setup(input, loading);
    fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});

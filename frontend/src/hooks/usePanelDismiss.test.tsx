import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePanelDismiss } from './usePanelDismiss';

function PanelExample() {
  const [open, setOpen] = useState(false);
  const { panelRef } = usePanelDismiss(open, () => setOpen(false), 1199);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开面板</button>
      {open && (
        <aside ref={panelRef} tabIndex={-1} aria-label="关联面板">
          <button>第一个操作</button>
          <button>最后一个操作</button>
        </aside>
      )}
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('reference panel keyboard controls', () => {
  it('moves focus into an opened panel and restores it after Escape', () => {
    render(<PanelExample />);
    const opener = screen.getByRole('button', { name: '打开面板' });
    opener.focus();
    fireEvent.click(opener);
    expect(
      screen.getByRole('complementary', { name: '关联面板' }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab within the panel on smaller screens', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    render(<PanelExample />);
    fireEvent.click(screen.getByRole('button', { name: '打开面板' }));
    const first = screen.getByRole('button', { name: '第一个操作' });
    const last = screen.getByRole('button', { name: '最后一个操作' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

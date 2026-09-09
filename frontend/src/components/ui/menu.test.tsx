import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Menu, MenuContent, MenuItem, MenuTrigger } from './menu';

describe('Menu', () => {
  it('opens with the keyboard, roves between items, selects, and restores focus', async () => {
    const selectSecond = vi.fn();

    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent aria-label="Note actions">
          <MenuItem>Rename</MenuItem>
          <MenuItem onClick={selectSecond}>Archive</MenuItem>
        </MenuContent>
      </Menu>,
    );

    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const menu = await screen.findByRole('menu', { name: 'Note actions' });
    const firstItem = screen.getByRole('menuitem', { name: 'Rename' });
    const secondItem = screen.getByRole('menuitem', { name: 'Archive' });
    await waitFor(() => expect(firstItem).toHaveFocus());

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await waitFor(() => expect(secondItem).toHaveFocus());

    fireEvent.keyDown(secondItem, { key: 'Enter' });

    expect(selectSecond).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('closes when Escape is pressed', async () => {
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent aria-label="Note actions">
          <MenuItem>Rename</MenuItem>
        </MenuContent>
      </Menu>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = await screen.findByRole('menu', { name: 'Note actions' });

    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});

import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceRoot from './WorkspaceRoot';
import { useWorkspace } from './WorkspaceContext';

const user = { id: 'u1', username: '测试用户', email: 'u1@example.com', createdAt: '2026-10-20' };
const m = vi.hoisted(() => ({ logout: vi.fn(), changePassword: vi.fn(), save: vi.fn(), discard: vi.fn(), path: vi.fn(),
  dirty: false, currentUser: null as { id: string } | null, token: 'original-token' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: m.path, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../utils/auth', () => ({ getUser: () => m.currentUser, getToken: () => m.token, logout: m.logout }));
vi.mock('../../services/inspirationService', () => ({ getUnviewedInspirationCount: async () => 0 }));
vi.mock('../../hooks/useInspirationSettings', () => ({ useInspirationSettings: () => ({ settings: { enabled: false }, loading: false, saving: false, error: null, refetch: vi.fn(), setEnabled: vi.fn() }) }));
vi.mock('./useWorkspaceRecentNotes', () => ({ useWorkspaceRecentNotes: () => ({ recentNotes: [], setRecentNotes: vi.fn(), status: 'ready', retry: vi.fn() }) }));
vi.mock('../../services/userService', () => ({ updateProfile: vi.fn(), changePassword: m.changePassword }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function NotePage() {
  const workspace = useWorkspace();
  const registerEditor = workspace?.registerEditor;
  useEffect(() => registerEditor?.({ isDirty: () => m.dirty, isSaving: () => false, save: m.save, discard: m.discard }), [registerEditor]);
  return <button onClick={() => workspace?.openSettings?.('account')}>打开账户设置</button>;
}
async function openPassword() {
  fireEvent.click(screen.getByText('打开账户设置'));
  fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
}
async function submitPassword() {
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'oldpass123' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass123' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass123' } });
  await act(async () => { fireEvent.submit(document.querySelector('form')!); });
}
function leaveWorkspace(view: ReturnType<typeof render>) {
  m.path.mockReturnValue('/auth');
  view.rerender(<WorkspaceRoot><div>认证页面</div></WorkspaceRoot>);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  m.path.mockReturnValue('/notes'); m.currentUser = user; m.token = 'original-token'; m.dirty = false;
  m.changePassword.mockResolvedValue(undefined);
  m.save.mockImplementation(async () => { m.dirty = false; return true; });
  m.discard.mockImplementation(() => { m.dirty = false; return true; });
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }), writable: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('password change and the live workspace editor', () => {
  it('asks about the dirty note before opening password inputs; continue keeps the draft', async () => {
    m.dirty = true;
    render(<WorkspaceRoot><NotePage /></WorkspaceRoot>);
    await openPassword();
    expect(screen.getByRole('dialog', { name: '保存未完成的修改？' })).toHaveAttribute('open');
    expect(screen.queryByLabelText('当前密码')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(m.dirty).toBe(true);
    expect(m.changePassword).not.toHaveBeenCalled();
  });
  it('opens password only after the existing note saves successfully', async () => {
    m.dirty = true;
    render(<WorkspaceRoot><NotePage /></WorkspaceRoot>);
    await openPassword();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存并继续' })); });
    expect(m.save).toHaveBeenCalledOnce();
    expect(m.dirty).toBe(false);
    expect(screen.getByLabelText('当前密码')).toBeInTheDocument();
  });
  it('does not open password if the background note failed to save', async () => {
    m.dirty = true; m.save.mockResolvedValue(false);
    render(<WorkspaceRoot><NotePage /></WorkspaceRoot>);
    await openPassword();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存并继续' })); });
    expect(m.dirty).toBe(true);
    expect(screen.queryByLabelText('当前密码')).toBeNull();
    expect(screen.getByRole('dialog', { name: '保存未完成的修改？' })).toHaveAttribute('open');
  });
  it('opens password after the user explicitly discards the note draft', async () => {
    m.dirty = true;
    render(<WorkspaceRoot><NotePage /></WorkspaceRoot>);
    await openPassword();
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(m.discard).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('当前密码')).toBeInTheDocument();
  });
  it('finishes logout even if the password dialog unmounts during the success delay', async () => {
    const view = render(<WorkspaceRoot><NotePage /></WorkspaceRoot>);
    await openPassword(); await submitPassword();
    leaveWorkspace(view);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(m.logout).toHaveBeenCalledOnce();
  });
  it('finishes logout when the server success arrives after the form unmounted', async () => {
    let resolve!: () => void;
    m.changePassword.mockReturnValue(new Promise<void>(r => { resolve = r; }));
    const view = render(<WorkspaceRoot><NotePage /></WorkspaceRoot>);
    await openPassword(); await submitPassword();
    leaveWorkspace(view);
    await act(async () => { resolve(); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(m.logout).toHaveBeenCalledOnce();
  });
  it.each(['different-user', 'new-token'])('does not log out a later session: %s', async (change) => {
    const view = render(<WorkspaceRoot><NotePage /></WorkspaceRoot>);
    await openPassword(); await submitPassword();
    leaveWorkspace(view);
    if (change === 'different-user') m.currentUser = { id: 'u2' };
    else m.token = 'fresh-login-token';
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(m.logout).not.toHaveBeenCalled();
  });
});

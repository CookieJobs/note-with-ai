import React, { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceAccountDialogs, { type WorkspaceAccountDialogsProps } from './WorkspaceAccountDialogs';
import type { User } from '../../../utils/auth';

const mocks = vi.hoisted(() => ({ updateProfile: vi.fn(), changePassword: vi.fn(), logout: vi.fn(), getToken: vi.fn(), getUser: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('../../../services/userService', () => ({ updateProfile: mocks.updateProfile, changePassword: mocks.changePassword }));
vi.mock('../../../utils/auth', () => ({ logout: mocks.logout, getToken: mocks.getToken, getUser: mocks.getUser }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
const user: User = { id: 'one', username: '旧名字', email: 'one@example.com', avatar: 'legacy:unknown', createdAt: '2026-01-01' };
function setup(overrides: Partial<WorkspaceAccountDialogsProps> = {}) {
  const props: WorkspaceAccountDialogsProps = { kind: 'profile', user, onClose: vi.fn(), onSaved: vi.fn(), ...overrides };
  return { ...render(<WorkspaceAccountDialogs {...props} />), props };
}
function fillPassword() {
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'current123' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass123' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass123' } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.getToken.mockReturnValue('user-one-token'); mocks.getUser.mockReturnValue(user);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  mocks.updateProfile.mockResolvedValue({ ...user, username: '服务端名字' });
  mocks.changePassword.mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('共享账户表单', () => {
  it.each(['取消', '关闭', 'Escape', '遮罩'])('资料脏输入通过%s关闭前须确认且继续编辑保留草稿', (source) => {
    const { props } = setup();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: '草稿' } });
    if (source === 'Escape') fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
    else if (source === '遮罩') fireEvent.click(screen.getByRole('dialog'));
    else fireEvent.click(screen.getByRole('button', { name: source }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('放弃未保存的修改？');
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('用户名')).toHaveValue('草稿');
    expect(screen.getByLabelText('用户名')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['取消', '关闭', 'Escape', '遮罩'])('密码脏输入通过%s关闭也须确认', (source) => {
    const { props } = setup({ kind: 'password' });
    fillPassword();
    if (source === 'Escape') fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
    else if (source === '遮罩') fireEvent.click(screen.getByRole('dialog'));
    else fireEvent.click(screen.getByRole('button', { name: source }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('当前密码')).toHaveValue('current123');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each(['profile', 'password'] as const)('%s保存中拦截Escape/遮罩且禁输入与重入', (kind) => {
    mocks.updateProfile.mockReturnValue(new Promise(() => {}));
    mocks.changePassword.mockReturnValue(new Promise(() => {}));
    const { props } = setup({ kind });
    if (kind === 'password') fillPassword();
    fireEvent.submit(document.querySelector('form')!);
    fireEvent.submit(document.querySelector('form')!);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
    expect(screen.getByLabelText(kind === 'profile' ? '用户名' : '当前密码')).toBeDisabled();
    expect(kind === 'profile' ? mocks.updateProfile : mocks.changePassword).toHaveBeenCalledTimes(1);
  });

  it('失败保留资料草稿，重试才合并服务端资料', async () => {
    const pending = deferred<User>();
    mocks.updateProfile.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(pending.promise);
    const { props } = setup();
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: ' 草稿 ' } });
    await act(async () => fireEvent.submit(document.querySelector('form')!));
    expect(screen.getByRole('alert')).toHaveTextContent('更新失败');
    expect(screen.getByLabelText('用户名')).toHaveValue(' 草稿 ');
    expect(props.onSaved).not.toHaveBeenCalled();
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => pending.resolve({ ...user, username: '服务端名字' }));
    expect(mocks.updateProfile).toHaveBeenLastCalledWith({ username: '草稿' });
    expect(props.onSaved).toHaveBeenCalledWith({ ...user, username: '服务端名字' });
  });

  it('密码失败不清输入或登出，成功后按原延时登出且不持久化密码', async () => {
    vi.useFakeTimers();
    try {
      mocks.changePassword.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
      const storage = vi.spyOn(Storage.prototype, 'setItem');
      setup({ kind: 'password' });
      fillPassword();
      await act(async () => fireEvent.submit(document.querySelector('form')!));
      expect(screen.getByLabelText('新密码')).toHaveValue('newpass123');
      expect(mocks.logout).not.toHaveBeenCalled();
      await act(async () => fireEvent.submit(document.querySelector('form')!));
      expect(screen.getByLabelText('新密码')).toHaveValue('');
      expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
      await act(async () => vi.advanceTimersByTime(1500));
      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(storage).not.toHaveBeenCalled();
      storage.mockRestore();
    } finally { vi.useRealTimers(); }
  });

  it.each(['profile', 'password'] as const)('%s迟到成功不能污染已切换的账户', async (kind) => {
    const pending = deferred<User>();
    mocks.updateProfile.mockReturnValue(pending.promise);
    mocks.changePassword.mockReturnValue(pending.promise);
    const { props, rerender } = setup({ kind });
    if (kind === 'password') fillPassword();
    fireEvent.submit(document.querySelector('form')!);
    mocks.getUser.mockReturnValue({ ...user, id: 'two' });
    rerender(<WorkspaceAccountDialogs {...props} user={{ ...user, id: 'two', username: '另一个账户' }} />);
    await act(async () => pending.resolve({ ...user, username: '迟到旧名字' }));
    await act(async () => vi.advanceTimersByTime(1500));
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('关闭后恢复Root捕获的触发按钮焦点', () => {
    const trigger = document.createElement('button'); document.body.append(trigger);
    const returnFocus = createRef<HTMLElement>(); Object.defineProperty(returnFocus, 'current', { value: trigger });
    const { unmount } = setup({ returnFocus });
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it.each([
    ['', 'valid123', 'valid123', '请输入当前密码'],
    ['current', 'a1', 'a1', '新密码至少8位'],
    ['current', 'abcdefgh', 'abcdefgh', '密码必须包含字母和数字'],
    ['current', '12345678', '12345678', '密码必须包含字母和数字'],
    ['current', 'valid123', 'different123', '两次密码输入不一致'],
  ])('保留原密码校验：%s/%s/%s', async (oldPassword, newPassword, confirmPassword, message) => {
    setup({ kind: 'password' });
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: oldPassword } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: newPassword } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirmPassword } });
    fireEvent.submit(document.querySelector('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });
});

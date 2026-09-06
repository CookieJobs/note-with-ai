import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import AdminLoginPage from './page';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

function fillLoginForm() {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'owner@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password1234' } });
  fireEvent.change(screen.getByLabelText('6 位验证码'), { target: { value: '123456' } });
}

describe('AdminLoginPage', () => {
  beforeEach(() => {
    navigation.replace.mockReset();
    vi.stubEnv('NEXT_PUBLIC_ADMIN_LOCAL_PASSWORD_ONLY', 'false');
    vi.stubEnv('NODE_ENV', 'test');
  });
  afterEach(() => vi.restoreAllMocks());

  it('submits the independent admin credentials and redirects after success', async () => {
    const post = vi.spyOn(api, 'adminPost').mockResolvedValue({});
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    render(<AdminLoginPage />);

    const otp = screen.getByLabelText('6 位验证码');
    expect(otp).toHaveAttribute('inputmode', 'numeric');
    expect(otp).toHaveAttribute('pattern', '[0-9]{6}');
    expect(otp).toHaveAttribute('maxlength', '6');

    fillLoginForm();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/auth/login', {
      email: 'owner@example.com',
      password: 'password1234',
      otp: '123456',
    }));
    expect(storageWrite).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('/admin');
  });

  it('disables submit and exposes a pending label while logging in', async () => {
    let resolveLogin!: (value: unknown) => void;
    vi.spyOn(api, 'adminPost').mockImplementation(
      () => new Promise((resolve) => { resolveLogin = resolve; }),
    );
    render(<AdminLoginPage />);
    fillLoginForm();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByRole('button', { name: '登录中…' })).toBeDisabled();
    resolveLogin({});
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/admin'));
  });

  it('shows the same generic error for every rejected login', async () => {
    vi.spyOn(api, 'adminPost').mockRejectedValue(new Error('数据库中的敏感错误'));
    render(<AdminLoginPage />);
    fillLoginForm();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱、密码或验证码错误');
    expect(screen.queryByText('数据库中的敏感错误')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
  });

  it('uses a password-only payload and hides TOTP when explicitly enabled for local development', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_LOCAL_PASSWORD_ONLY', 'true');
    const post = vi.spyOn(api, 'adminPost').mockResolvedValue({});
    render(<AdminLoginPage />);
    expect(screen.queryByLabelText('6 位验证码')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password1234' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/auth/login', {
      email: 'owner@example.com', password: 'password1234',
    }));
  });

  it('keeps the TOTP field in a production build even if a local flag was copied there', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_LOCAL_PASSWORD_ONLY', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    render(<AdminLoginPage />);
    expect(screen.getByLabelText('6 位验证码')).toBeInTheDocument();
  });
});

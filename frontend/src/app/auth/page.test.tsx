import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuthPage from './page';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
}));

describe('AuthPage', () => {
  beforeEach(() => {
    navigation.push.mockReset();
  });

  it('exposes labeled login controls and identifies the selected mode', () => {
    render(<AuthPage />);

    expect(screen.getByRole('tab', { name: '登录' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/^邮箱 \*$/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/^密码 \*$/)).toHaveAttribute('type', 'password');
  });

  it('exposes labeled registration and reset controls in their selected modes', () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByRole('tab', { name: '注册' }));
    expect(screen.getByRole('tab', { name: '注册' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/^邮箱 \*$/)).toBeRequired();
    expect(screen.getByLabelText(/^密码 \*$/)).toBeRequired();
    expect(screen.getByLabelText(/^验证码 \*$/)).toBeRequired();

    fireEvent.click(screen.getByRole('tab', { name: '重置密码' }));
    expect(screen.getByRole('tab', { name: '重置密码' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/^邮箱 \*$/)).toBeRequired();
    expect(screen.getByLabelText(/^新密码 \*$/)).toBeRequired();
    expect(screen.getByLabelText(/^验证码 \*$/)).toBeRequired();
  });

  it('keeps one tab stop while keyboard navigation moves mode selection', () => {
    render(<AuthPage />);

    const login = screen.getByRole('tab', { name: '登录' });
    const register = screen.getByRole('tab', { name: '注册' });
    const reset = screen.getByRole('tab', { name: '重置密码' });

    expect(login).toHaveAttribute('tabindex', '0');
    expect(register).toHaveAttribute('tabindex', '-1');
    expect(reset).toHaveAttribute('tabindex', '-1');

    login.focus();
    fireEvent.keyDown(login, { key: 'ArrowRight' });

    expect(register).toHaveAttribute('aria-selected', 'true');
    expect(register).toHaveAttribute('tabindex', '0');
    expect(login).toHaveAttribute('tabindex', '-1');
    expect(register).toHaveFocus();

    fireEvent.keyDown(register, { key: 'End' });

    expect(reset).toHaveAttribute('aria-selected', 'true');
    expect(reset).toHaveAttribute('tabindex', '0');
    expect(register).toHaveAttribute('tabindex', '-1');
    expect(reset).toHaveFocus();

    fireEvent.keyDown(reset, { key: 'Home' });

    expect(login).toHaveAttribute('aria-selected', 'true');
    expect(login).toHaveAttribute('tabindex', '0');
    expect(reset).toHaveAttribute('tabindex', '-1');
    expect(login).toHaveFocus();
  });

  it('names the password visibility action by its next result', () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));

    expect(screen.getByLabelText(/^密码 \*$/)).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: '隐藏密码' })).toBeInTheDocument();
  });

  it('associates validation errors with the invalid field', () => {
    render(<AuthPage />);

    fireEvent.submit(screen.getByRole('tabpanel'));

    const email = screen.getByLabelText(/^邮箱 \*$/);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', 'auth-email-error');
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的邮箱地址');
  });
});

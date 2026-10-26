import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import AuthPage from './page';

describe('authentication form accessibility', () => {
  it('exposes labeled email and password fields and a named password visibility control', () => {
    render(<AuthPage />);

    expect(screen.getByRole('textbox', { name: '邮箱' })).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示密码' })).toBeInTheDocument();
  });

  it('exposes the verification code by name in registration mode', () => {
    render(<AuthPage />);
    fireEvent.click(screen.getByRole('button', { name: /^注册$/ }));

    expect(screen.getByRole('textbox', { name: '验证码' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    expect(screen.getByRole('textbox', { name: '邮箱' })).toBeInTheDocument();
    expect(screen.getByLabelText('新密码')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '验证码' })).toBeInTheDocument();
  });
});

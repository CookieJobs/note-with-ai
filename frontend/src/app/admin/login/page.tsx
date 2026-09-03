'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import styles from '../admin.module.scss';
import { adminPost } from '../lib/adminApi';

type LoginForm = {
  email: string;
  password: string;
  otp: string;
};

const initialForm: LoginForm = { email: '', password: '', otp: '' };

export default function AdminLoginPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await adminPost('/api/admin/auth/login', form);
      router.replace('/admin');
    } catch {
      setError('邮箱、密码或验证码错误');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.login}>
      <form onSubmit={(event) => void submit(event)}>
        <h1>运营后台</h1>
        <label>
          邮箱
          <input
            type="email"
            autoComplete="username"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required
          />
        </label>
        <label>
          6 位验证码
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={form.otp}
            onChange={(event) => setForm({ ...form, otp: event.target.value })}
            required
          />
        </label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button type="submit" disabled={pending}>{pending ? '登录中…' : '登录'}</button>
      </form>
    </main>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BookOpen, ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';

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
  const passwordOnlyLocalLogin = process.env.NODE_ENV !== 'production'
    && process.env.NEXT_PUBLIC_ADMIN_LOCAL_PASSWORD_ONLY === 'true';
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await adminPost('/api/admin/auth/login', passwordOnlyLocalLogin
        ? { email: form.email, password: form.password }
        : form);
      router.replace('/admin');
    } catch {
      setError(passwordOnlyLocalLogin ? '邮箱或密码错误' : '邮箱、密码或验证码错误');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={`${styles.adminTheme} ${styles.login}`}>
      <Link href="/notes" className={styles.loginBack}><ArrowLeft size={16} aria-hidden="true" />返回笔记应用</Link>
      <form onSubmit={(event) => void submit(event)}>
        <div className={styles.loginBrand}><span className={styles.brandMark}><BookOpen size={22} aria-hidden="true" /></span><span>NoteWithAI</span></div>
        <div className={styles.loginHeading}><h1>登录运营后台</h1><p>查看产品运行情况，处理用户与 AI 服务问题。</p></div>
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
        {!passwordOnlyLocalLogin && (
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
        )}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button type="submit" disabled={pending} className={styles.primaryButton}>{pending ? '登录中…' : '登录'}<ArrowRight size={16} aria-hidden="true" /></button>
        <p className={styles.loginFootnote}>{passwordOnlyLocalLogin ? '本地开发环境 · 管理员账号登录' : '请使用独立的管理员账号和验证器验证码。'}</p>
      </form>
    </main>
  );
}

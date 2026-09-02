'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminPost } from '../lib/adminApi';
import styles from '../admin.module.scss';
export default function AdminLoginPage() { const router = useRouter(); const [form, setForm] = useState({ email: '', password: '', otp: '' }); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setPending(true); setError(''); try { await adminPost('/api/admin/auth/login', form); router.replace('/admin'); } catch { setError('邮箱、密码或验证码错误'); } finally { setPending(false); } }
  return <main className={styles.login}><form onSubmit={submit}><h1>运营后台</h1><label>邮箱<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></label><label>密码<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></label><label>6 位验证码<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.otp} onChange={e => setForm({ ...form, otp: e.target.value })} required /></label>{error && <p role="alert">{error}</p>}<button disabled={pending}>{pending ? '登录中…' : '登录'}</button></form></main>;
}

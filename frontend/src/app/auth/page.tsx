'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import styles from './auth.module.scss';

type AuthMode = 'login' | 'register' | 'reset';

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    code: '',
  });
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setFormData({ email: '', password: '', code: '' });
    setError('');
    setCountdown(0);
    setLoading(false);
    setShowPassword(false);
  }, [mode]);

  useEffect(() => {
    if (countdown > 0) {
      timerRef.current = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [countdown]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) setError('');
  };

  const validateField = (): boolean => {
    if (!formData.email.includes('@')) {
      setError('请输入有效的邮箱地址');
      return false;
    }
    if (mode !== 'reset') {
      if (formData.password.length < 8) {
        setError('密码长度至少为8位');
        return false;
      }
      if (!/(?=.*[A-Za-z])(?=.*\d)/.test(formData.password)) {
        setError('密码必须包含字母和数字');
        return false;
      }
    }
    if (mode === 'register') {
      if (formData.code.length !== 6) {
        setError('请输入6位验证码');
        return false;
      }
    }
    return true;
  };

  const handleSendCode = async () => {
    if (!formData.email.includes('@')) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (countdown > 0) return;

    setSendingCode(true);
    setError('');

    try {
      const purpose = mode === 'register' ? 'register' : 'reset';
      const response = await fetch('/api/auth/send-verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, purpose }),
      });

      const data = await response.json();

      if (response.ok) {
        setCountdown(60);
      } else {
        setError(data.error || '验证码发送失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateField()) return;

    setLoading(true);
    setError('');

    try {
      let endpoint: string;
      let payload: Record<string, string>;

      if (mode === 'login') {
        endpoint = '/api/auth/login';
        payload = { email: formData.email, password: formData.password };
      } else if (mode === 'register') {
        endpoint = '/api/auth/register';
        payload = { email: formData.email, password: formData.password, code: formData.code };
      } else {
        endpoint = '/api/auth/reset-password';
        payload = { email: formData.email, code: formData.code, newPassword: formData.password };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        const result = data?.data ?? {};
        const token: string | undefined = result.token;
        const user = result.user;

        if (!token || !user) {
          setError('服务器响应无效');
          return;
        }

        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        router.push('/notes');
      } else {
        setError(data.error || '操作失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const modeLabel =
    mode === 'login'
      ? '登录 NoteWithAI'
      : mode === 'register'
        ? '创建账号'
        : '重置密码';
  const modeSubtitle =
    mode === 'login'
      ? '使用您的账号管理所有笔记'
      : mode === 'register'
        ? '加入我们，开启智能笔记之旅'
        : '输入注册邮箱，我们发送验证码给您';
  const submitLabel =
    mode === 'login' ? '登录' : mode === 'register' ? '注册' : '重置密码';
  const showCodeField = mode === 'register' || mode === 'reset';

  return (
    <div className={styles.container}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <span className={styles.brandLogo}>📝</span>
          <h2 className={styles.authTitle}>{modeLabel}</h2>
          <p className={styles.authSubtitle}>{modeSubtitle}</p>
        </div>

        <div className={styles.modeTabs}>
          <button
            className={`${styles.modeTab} ${mode === 'login' ? styles.active : ''}`}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            className={`${styles.modeTab} ${mode === 'register' ? styles.active : ''}`}
            onClick={() => setMode('register')}
          >
            注册
          </button>
          <button
            className={`${styles.modeTab} ${mode === 'reset' ? styles.active : ''}`}
            onClick={() => setMode('reset')}
          >
            重置密码
          </button>
        </div>

        <form className={styles.authForm} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            <input
              type="email"
              name="email"
              className={styles.input}
              placeholder="邮箱"
              value={formData.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </div>

          {mode !== 'reset' && (
            <div className={styles.inputGroup}>
              <div className={styles.passwordInput}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className={styles.input}
                  placeholder="密码"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
          )}

          {mode === 'reset' && (
            <div className={styles.inputGroup}>
              <div className={styles.passwordInput}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className={styles.input}
                  placeholder="新密码"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
          )}

          {showCodeField && (
            <div className={styles.verificationRow}>
              <input
                type="text"
                name="code"
                className={`${styles.input} ${styles.codeInput}`}
                placeholder="验证码"
                value={formData.code}
                onChange={handleChange}
                required
                maxLength={6}
                autoComplete="one-time-code"
              />
              <button
                type="button"
                className={styles.sendCodeBtn}
                onClick={handleSendCode}
                disabled={countdown > 0 || sendingCode}
              >
                {sendingCode
                  ? '发送中...'
                  : countdown > 0
                    ? `${countdown}s`
                    : '发送验证码'}
              </button>
            </div>
          )}

          {error && (
            <div className={styles.errorMessage}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={loading}
          >
            {loading ? (
              <div className={styles.loadingSpinner}>
                <div className={styles.spinner}></div>
              </div>
            ) : (
              submitLabel
            )}
          </button>
        </form>

        <div className={styles.authFooter}>
          {mode === 'login' && (
            <button className={styles.forgotPassword} onClick={() => setMode('reset')}>
              忘记密码？
            </button>
          )}
          {mode === 'login' && (
            <span className={styles.footerText}>
              还没有账号？{' '}
              <button className={styles.switchModeLink} onClick={() => setMode('register')}>
                立即注册
              </button>
            </span>
          )}
          {mode === 'register' && (
            <span className={styles.footerText}>
              已有账号？{' '}
              <button className={styles.switchModeLink} onClick={() => setMode('login')}>
                直接登录
              </button>
            </span>
          )}
          {mode === 'reset' && (
            <span className={styles.footerText}>
              <button className={styles.switchModeLink} onClick={() => setMode('login')}>
                返回登录
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

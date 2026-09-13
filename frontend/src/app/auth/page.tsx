'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';

import styles from './auth.module.scss';

type AuthMode = 'login' | 'register' | 'reset';
type AuthField = 'email' | 'password' | 'code';
const authModes: AuthMode[] = ['login', 'register', 'reset'];

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [formData, setFormData] = useState({ email: '', password: '', code: '' });
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<AuthField | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modeTabRefs = useRef<Record<AuthMode, HTMLButtonElement | null>>({
    login: null,
    register: null,
    reset: null,
  });

  useEffect(() => {
    setFormData({ email: '', password: '', code: '' });
    setError('');
    setErrorField(null);
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

  const showFieldError = (field: AuthField, message: string) => {
    setError(message);
    setErrorField(field);
  };

  const handleModeTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, authMode: AuthMode) => {
    const currentIndex = authModes.indexOf(authMode);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % authModes.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + authModes.length) % authModes.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = authModes.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextMode = authModes[nextIndex];
    setMode(nextMode);
    modeTabRefs.current[nextMode]?.focus();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) {
      setError('');
      setErrorField(null);
    }
  };

  const validateField = (): boolean => {
    if (!formData.email.includes('@')) {
      showFieldError('email', '请输入有效的邮箱地址');
      return false;
    }
    if (mode !== 'reset') {
      if (formData.password.length < 8) {
        showFieldError('password', '密码长度至少为8位');
        return false;
      }
      if (!/(?=.*[A-Za-z])(?=.*\d)/.test(formData.password)) {
        showFieldError('password', '密码必须包含字母和数字');
        return false;
      }
    }
    if (mode === 'register' && formData.code.length !== 6) {
      showFieldError('code', '请输入6位验证码');
      return false;
    }
    return true;
  };

  const handleSendCode = async () => {
    if (!formData.email.includes('@')) {
      showFieldError('email', '请输入有效的邮箱地址');
      return;
    }
    if (countdown > 0) return;

    setSendingCode(true);
    setError('');
    setErrorField(null);

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
        showFieldError('email', data.error || '验证码发送失败');
      }
    } catch {
      showFieldError('email', '网络错误，请稍后重试');
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateField()) return;

    setLoading(true);
    setError('');
    setErrorField(null);

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

  const modeLabel = mode === 'login' ? '登录 NoteWithAI' : mode === 'register' ? '创建账号' : '重置密码';
  const modeSubtitle = mode === 'login'
    ? '使用您的账号管理所有笔记'
    : mode === 'register'
      ? '加入我们，开启智能笔记之旅'
      : '输入注册邮箱，我们发送验证码给您';
  const submitLabel = mode === 'login' ? '登录' : mode === 'register' ? '注册' : '重置密码';
  const showCodeField = mode === 'register' || mode === 'reset';
  const passwordLabel = mode === 'reset' ? '新密码' : '密码';

  return (
    <div className={styles.container}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <span className={styles.brandMark}>NoteWithAI</span>
          <h2 className={styles.authTitle}>{modeLabel}</h2>
          <p className={styles.authSubtitle}>{modeSubtitle}</p>
        </div>

        <div className={styles.modeTabs} role="tablist" aria-label="认证方式">
          {authModes.map((authMode) => {
            const label = authMode === 'login' ? '登录' : authMode === 'register' ? '注册' : '重置密码';
            const isSelected = mode === authMode;

            return (
              <Button
                key={authMode}
                ref={(element) => { modeTabRefs.current[authMode] = element; }}
                id={`${authMode}-tab`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls="auth-form-panel"
                tabIndex={isSelected ? 0 : -1}
                className={`${styles.modeTab} ${isSelected ? styles.active : ''}`}
                variant="ghost"
                onClick={() => setMode(authMode)}
                onKeyDown={(event) => handleModeTabKeyDown(event, authMode)}
              >
                {label}
              </Button>
            );
          })}
        </div>

        <div id="auth-form-panel" role="tabpanel" aria-labelledby={`${mode}-tab`}>
        <form className={styles.authForm} onSubmit={handleSubmit}>
          <FormField id="auth-email" label="邮箱" error={errorField === 'email' ? error : undefined} required className={styles.inputGroup}>
            <input
              type="email"
              name="email"
              className={styles.input}
              placeholder="name@example.com"
              value={formData.email}
              onChange={handleChange}
              autoComplete="email"
            />
          </FormField>

          <div className={styles.passwordField}>
            <FormField id="auth-password" label={passwordLabel} error={errorField === 'password' ? error : undefined} required className={styles.inputGroup}>
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                className={styles.input}
                placeholder="至少 8 位，包含字母与数字"
                value={formData.password}
                onChange={handleChange}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </FormField>
            <Button
              type="button"
              className={styles.passwordToggle}
              variant="ghost"
              size="icon"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </Button>
          </div>

          {showCodeField && (
            <div className={styles.verificationRow}>
              <FormField id="auth-code" label="验证码" error={errorField === 'code' ? error : undefined} required className={`${styles.inputGroup} ${styles.codeField}`}>
                <input
                  type="text"
                  name="code"
                  className={styles.input}
                  placeholder="6 位验证码"
                  value={formData.code}
                  onChange={handleChange}
                  maxLength={6}
                  autoComplete="one-time-code"
                />
              </FormField>
              <Button type="button" className={styles.sendCodeBtn} variant="secondary" onClick={handleSendCode} disabled={countdown > 0 || sendingCode}>
                {sendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '发送验证码'}
              </Button>
            </div>
          )}

          {error && !errorField && <p className={styles.formError} role="alert">{error}</p>}

          <Button type="submit" className={styles.submitButton} size="lg" disabled={loading} aria-label={loading ? '正在处理' : submitLabel}>
            {loading ? <span className={styles.spinner} aria-hidden="true" /> : submitLabel}
          </Button>
        </form>
        </div>

        <div className={styles.authFooter}>
          {mode === 'login' && (
            <Button type="button" className={styles.forgotPassword} variant="link" onClick={() => setMode('reset')}>忘记密码？</Button>
          )}
          {mode === 'login' && (
            <span className={styles.footerText}>
              还没有账号？{' '}
              <Button type="button" className={styles.switchModeLink} variant="link" onClick={() => setMode('register')}>立即注册</Button>
            </span>
          )}
          {mode === 'register' && (
            <span className={styles.footerText}>
              已有账号？{' '}
              <Button type="button" className={styles.switchModeLink} variant="link" onClick={() => setMode('login')}>直接登录</Button>
            </span>
          )}
          {mode === 'reset' && (
            <span className={styles.footerText}>
              <Button type="button" className={styles.switchModeLink} variant="link" onClick={() => setMode('login')}>返回登录</Button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

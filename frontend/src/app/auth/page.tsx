/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import styles from './auth.module.scss';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  // 清除表单数据当切换模式时
  useEffect(() => {
    setFormData({
      username: '',
      email: '',
      password: '',
      confirmPassword: ''
    });
    setError('');
  }, [isLogin]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    // 清除错误信息
    if (error) setError('');
  };

  const validateForm = () => {
    if (!isLogin) {
      if (formData.password !== formData.confirmPassword) {
        setError('两次输入的密码不一致');
        return false;
      }
      if (formData.password.length < 8) {
        setError('密码长度至少为8位');
        return false;
      }
      if (!/(?=.*[A-Za-z])(?=.*\d)/.test(formData.password)) {
        setError('密码必须包含字母和数字');
        return false;
      }
      if (!formData.email.includes('@')) {
        setError('请输入有效的邮箱地址');
        return false;
      }
      if (formData.username.length < 2) {
        setError('用户名长度至少为2位');
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const payload = isLogin 
        ? { email: formData.email, password: formData.password }
        : { username: formData.username, email: formData.email, password: formData.password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        const payload = data?.data ?? {};
        const token: string | undefined = payload.token;
        const user = payload.user;

        if (!token || !user) {
          setError('服务器响应无效');
          return;
        }

        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        router.push('/notes');
      } else {
        setError(data.error || (isLogin ? '登录失败' : '注册失败'));
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <span className={styles.brandLogo}>📝</span>
          <h2 className={styles.authTitle}>
            {isLogin ? '登录 NoteWithAI' : '创建账号'}
          </h2>
          <p className={styles.authSubtitle}>
            {isLogin ? '使用您的账号管理所有笔记' : '加入我们，开启智能笔记之旅'}
          </p>
        </div>

        <form className={styles.authForm} onSubmit={handleSubmit}>
          {!isLogin && (
            <div className={styles.inputGroup}>
              <input
                type="text"
                name="username"
                className={styles.input}
                placeholder="用户名"
                value={formData.username}
                onChange={handleChange}
                required
                minLength={2}
              />
            </div>
          )}

          <div className={styles.inputGroup}>
            <input
              type="email"
              name="email"
              id="email"
              className={styles.input}
              placeholder="邮箱或用户名"
              value={formData.email}
              onChange={handleChange}
              required
              autoComplete="username"
            />
          </div>

          <div className={styles.inputGroup}>
            <div className={styles.passwordInput}>
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                id="password"
                className={styles.input}
                placeholder="密码"
                value={formData.password}
                onChange={handleChange}
                required
                autoComplete={isLogin ? "current-password" : "new-password"}
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

          {!isLogin && (
            <div className={styles.inputGroup}>
              <input
                type="password"
                name="confirmPassword"
                id="confirmPassword"
                className={styles.input}
                placeholder="确认密码"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                autoComplete="new-password"
              />
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
              '继续'
            )}
          </button>
        </form>

        <div className={styles.authFooter}>
          {isLogin ? (
            <>
              <a href="#" className={styles.forgotPassword}>
                忘记密码？
              </a>
              <span className={styles.footerText}>
                还没有账号？ 
                <button 
                  className={styles.switchModeLink}
                  onClick={() => setIsLogin(false)}
                >
                  立即注册
                </button>
              </span>
            </>
          ) : (
            <span className={styles.footerText}>
              已有账号？
              <button 
                className={styles.switchModeLink}
                onClick={() => setIsLogin(true)}
              >
                直接登录
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
      if (formData.password.length < 6) {
        setError('密码长度至少为6位');
        return false;
      }
      if (!formData.email.includes('@')) {
        setError('请输入有效的邮箱地址');
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
        ? { username: formData.username, password: formData.password }
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
        // 后端统一响应: { success, message, data: { token, user } }
        const payload = data?.data ?? {};
        const token: string | undefined = payload.token;
        const user = payload.user;

        if (!token || !user) {
          setError('登录响应无效，请重试');
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
      <div className={styles.leftPanel}>
        <div className={styles.brandSection}>
          <div className={styles.logo}>
            <div className={styles.logoIcon}>📝</div>
            <h1 className={styles.brandName}>NoteWithAI</h1>
          </div>
          <p className={styles.brandDescription}>
            智能笔记助手，让思考更有条理
          </p>
          <div className={styles.features}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>🤖</span>
              <span>AI 智能对话</span>
            </div>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>📚</span>
              <span>知识管理</span>
            </div>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>🔍</span>
              <span>智能搜索</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.rightPanel}>
        <div className={styles.authCard}>
          <div className={styles.authHeader}>
            <h2 className={styles.authTitle}>
              {isLogin ? '欢迎回来' : '创建账号'}
            </h2>
            <p className={styles.authSubtitle}>
              {isLogin ? '登录您的账号以继续使用' : '注册新账号开始您的智能笔记之旅'}
            </p>
          </div>

          <div className={styles.authTabs}>
            <button
              className={`${styles.tab} ${isLogin ? styles.active : ''}`}
              onClick={() => setIsLogin(true)}
              type="button"
            >
              登录
            </button>
            <button
              className={`${styles.tab} ${!isLogin ? styles.active : ''}`}
              onClick={() => setIsLogin(false)}
              type="button"
            >
              注册
            </button>
          </div>

          <form className={styles.authForm} onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
              <label className={styles.label}>用户名</label>
              <input
                type="text"
                name="username"
                className={styles.input}
                placeholder="请输入用户名"
                value={formData.username}
                onChange={handleChange}
                required
              />
            </div>

            {!isLogin && (
              <div className={styles.inputGroup}>
                <label className={styles.label}>邮箱</label>
                <input
                  type="email"
                  name="email"
                  className={styles.input}
                  placeholder="请输入邮箱地址"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
            )}

            <div className={styles.inputGroup}>
              <label className={styles.label}>密码</label>
              <div className={styles.passwordInput}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className={styles.input}
                  placeholder="请输入密码"
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            {!isLogin && (
              <div className={styles.inputGroup}>
                <label className={styles.label}>确认密码</label>
                <input
                  type="password"
                  name="confirmPassword"
                  className={styles.input}
                  placeholder="请再次输入密码"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                />
              </div>
            )}

            {error && (
              <div className={styles.errorMessage}>
                <span className={styles.errorIcon}>⚠️</span>
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
                  {isLogin ? '登录中...' : '注册中...'}
                </div>
              ) : (
                isLogin ? '登录' : '创建账号'
              )}
            </button>
          </form>

          {isLogin && (
            <div className={styles.authFooter}>
              <a href="#" className={styles.forgotPassword}>
                忘记密码？
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { getUser, logout } from '../utils/auth';
import { getUnviewedInspirationCount } from '../services/inspirationService';
import styles from './TopNavigation.module.scss';
import { Menu } from 'lucide-react';
import { useWorkspace } from './workspace/WorkspaceContext';
import workspaceStyles from './workspace/Workspace.module.scss';

const menuItems = [
  { label: '笔记', href: '/notes' },
  { label: '聊天', href: '/chat' },
  { label: '灵感', href: '/inspiration' },
];

interface TopNavigationProps {
  onMenuClick?: () => void;
}

export default function TopNavigation(props: TopNavigationProps = {}) {
  const workspace = useWorkspace();
  if (workspace) return props.onMenuClick ? <button type="button" className={workspaceStyles.legacyChatHistoryToggle} aria-label="打开对话历史" onClick={props.onMenuClick}><Menu size={18} />对话历史</button> : null;
  return <LegacyTopNavigation {...props} />;
}

function LegacyTopNavigation({ onMenuClick }: TopNavigationProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const [unviewedInspirationCount, setUnviewedInspirationCount] = useState(0);
  const activeIndex = menuItems.findIndex(({ href }) => pathname === href || pathname.startsWith(`${href}/`));

  useEffect(() => {
    const userData = getUser();
    setUser(userData);
    if (!userData) return;
    let active = true;
    const refreshCount = () => {
      void getUnviewedInspirationCount()
        .then((count) => { if (active) setUnviewedInspirationCount(count); })
        .catch(() => undefined);
    };
    refreshCount();
    const interval = window.setInterval(refreshCount, 60_000);
    window.addEventListener('inspiration-count-changed', refreshCount);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('inspiration-count-changed', refreshCount);
    };
  }, []);

  const handleLogout = () => {
    logout();
    setShowUserMenu(false);
  };

  useEffect(() => {
    if (!showUserMenu) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowUserMenu(false);
      userButtonRef.current?.focus();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showUserMenu]);

  return (
    <header className={styles.topNav}>
      <div className={styles.container}>
        {/* 左侧 Logo */}
        <div className={styles.leftSection}>
          {pathname.startsWith('/chat') && (
            <button
              className={styles.mobileMenu}
              onClick={onMenuClick}
              aria-label="打开侧边栏"
            >
              <Menu size={20} />
            </button>
          )}
          <h1 className={styles.logo}>NoteWithAI</h1>
        </div>

        {/* 中间导航菜单 */}
        <div className={styles.middleSection}>
          <nav
            className={styles.nav}
            data-active-index={activeIndex}
            aria-label="主导航"
          >
            {menuItems.map(({ label, href }) => {
              const isActive = pathname === href;
              const showNewBadge = label === '灵感' && unviewedInspirationCount > 0;
              const navContent = (
                <>
                  <span>{label}</span>
                  {showNewBadge && <span className={styles.inspirationBadge} aria-label={`${unviewedInspirationCount} 条新灵感`}>{unviewedInspirationCount > 99 ? '99+' : unviewedInspirationCount}</span>}
                </>
              );
              if (isActive) {
                return (
                  <span
                    key={href}
                    className={`${styles.navItem} ${styles.active}`}
                    aria-current="page"
                  >
                    {navContent}
                  </span>
                );
              }

              return (
                <Link
                  key={href}
                  href={href}
                  className={styles.navItem}
                >
                  {navContent}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 右侧用户信息 */}
        <div className={styles.rightSection}>
          {user && (
            <div className={styles.userSection}>
              <button
                type="button"
                ref={userButtonRef}
                className={styles.userInfo}
                onClick={() => setShowUserMenu(!showUserMenu)}
                aria-label="账户菜单"
                aria-expanded={showUserMenu}
                aria-controls="account-menu"
              >
                <span className={styles.avatar} aria-hidden="true">{String(user.username || user.email || 'N').slice(0, 1).toUpperCase()}</span>
                <span className={styles.userName}>{user.username}</span>
                <svg
                  className={`${styles.chevron} ${showUserMenu ? styles.chevronUp : ''}`}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {showUserMenu && (
                <div className={styles.userMenu} id="account-menu">
                  <div className={styles.userMenuHeader}>
                    <div className={styles.userDetails}>
                      <span className={styles.userNameLarge}>{user.username}</span>
                      <span className={styles.userEmail}>{user.email}</span>
                    </div>
                  </div>

                  <div className={styles.userMenuDivider} />

                  <Link
                    href="/profile"
                    className={styles.menuLink}
                    onClick={() => setShowUserMenu(false)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    个人中心
                  </Link>

                  <div className={styles.userMenuDivider} />

                  <button onClick={handleLogout} className={styles.logoutButton}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    退出账户
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 点击外部关闭用户菜单 */}
      {showUserMenu && (
        <div
          className={styles.overlay}
          onClick={() => setShowUserMenu(false)}
        />
      )}
    </header>
  );
}

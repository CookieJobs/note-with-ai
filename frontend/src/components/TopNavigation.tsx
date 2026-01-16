/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { getUser, logout } from '../utils/auth';
import styles from './TopNavigation.module.scss';

const menuItems = [
  { label: '笔记', href: '/notes' },
  { label: '聊天', href: '/chat' },
];

export default function TopNavigation() {
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const activeIndex = pathname.startsWith('/chat') ? 1 : 0;

  useEffect(() => {
    const userData = getUser();
    setUser(userData);
  }, []);

  const handleLogout = () => {
    logout();
    setShowUserMenu(false);
  };

  return (
    <header className={styles.topNav}>
      <div className={styles.container}>
        {/* 左侧 Logo */}
        <div className={styles.leftSection}>
          <h1 className={styles.logo}>NoteWithAI</h1>
        </div>

        {/* 中间导航菜单 */}
        <div className={styles.middleSection}>
          <nav
            className={`${styles.nav} ${activeIndex === 0 ? styles.navActiveLeft : styles.navActiveRight}`}
            data-active-index={activeIndex}
            aria-label="主导航"
          >
            {/* 常驻“滑动高光底板”：默认停在当前激活项上，hover 另一项时滑过去 */}
            <span className={styles.navHoverPill} aria-hidden="true" />
            {menuItems.map(({ label, href }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 右侧用户信息 */}
        <div className={styles.rightSection}>
          {user && (
            <div className={styles.userSection}>
              <div 
                className={styles.userInfo}
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
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
              </div>
              
              {showUserMenu && (
                <div className={styles.userMenu}>
                  <div className={styles.userMenuHeader}>
                    <div className={styles.userDetails}>
                      <span className={styles.userNameLarge}>{user.username}</span>
                      <span className={styles.userEmail}>{user.email}</span>
                    </div>
                  </div>
                  <div className={styles.userMenuDivider}></div>
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

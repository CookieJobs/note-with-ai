'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { getUser, logout } from '../utils/auth';
import { Menu as AccountMenu, MenuContent, MenuItem, MenuTrigger } from './ui/menu';
import styles from './TopNavigation.module.scss';

const menuItems = [
  { label: '笔记', href: '/notes' },
  { label: '聊天', href: '/chat' },
  { label: '灵感', href: '/inspiration' },
];

interface TopNavigationProps {
  onMenuClick?: () => void;
}

export default function TopNavigation({ onMenuClick }: TopNavigationProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const activeIndex = pathname.startsWith('/chat') ? 1 : pathname.startsWith('/inspiration') ? 2 : 0;

  useEffect(() => {
    setUser(getUser());
  }, []);

  const handleLogout = () => {
    logout();
  };

  return (
    <header className={styles.topNav}>
      <div className={styles.container}>
        <div className={styles.leftSection}>
          {pathname.startsWith('/chat') && (
            <button
              className="md:hidden mr-2 p-2 -ml-2 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center bg-transparent border-none"
              onClick={onMenuClick}
              aria-label="打开侧边栏"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          )}
          <Link href="/notes" className={styles.logo}>NoteWithAI</Link>
        </div>

        <div className={styles.middleSection}>
          <nav className={styles.nav} data-active-index={activeIndex} aria-label="主导航">
            <span className={styles.navHoverPill} aria-hidden="true" />
            {menuItems.map(({ label, href }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              if (isActive) {
                return (
                  <span key={href} className={`${styles.navItem} ${styles.active}`} aria-current="page">
                    {label}
                  </span>
                );
              }

              return (
                <Link key={href} href={href} className={styles.navItem}>
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className={styles.rightSection}>
          {user && (
            <AccountMenu>
              <MenuTrigger className={styles.userInfo}>
                <span className={styles.userName}>{user.username}</span>
                <svg className={styles.chevron} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </MenuTrigger>

              <MenuContent className={styles.userMenu} aria-label="账户菜单">
                <div className={styles.userMenuHeader}>
                  <div className={styles.userDetails}>
                    <span className={styles.userNameLarge}>{user.username}</span>
                    <span className={styles.userEmail}>{user.email}</span>
                  </div>
                </div>

                <div className={styles.userMenuDivider} />

                <MenuItem className={styles.menuLink} onClick={() => router.push('/profile')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  个人中心
                </MenuItem>
                <MenuItem className={styles.menuLink} onClick={() => router.push('/memory')}>AI 记忆</MenuItem>
                <MenuItem className={styles.menuLink} onClick={() => router.push('/publish')}>公开内容</MenuItem>

                <div className={styles.userMenuDivider} />

                <MenuItem onClick={handleLogout} className={styles.logoutButton}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  退出账户
                </MenuItem>
              </MenuContent>
            </AccountMenu>
          )}
        </div>
      </div>
    </header>
  );
}

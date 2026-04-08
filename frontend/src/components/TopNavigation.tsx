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
import { Menu } from 'lucide-react';

const menuItems = [
  { label: '笔记', href: '/notes' },
  { label: '聊天', href: '/chat' },
];

interface TopNavigationProps {
  onMenuClick?: () => void;
}

export default function TopNavigation({ onMenuClick }: TopNavigationProps = {}) {
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
    <header className={`${styles.topNav} !bg-gray-50 !backdrop-filter-none !border-b !border-gray-100`}>
      <div className={styles.container}>
        {/* 左侧 Logo */}
        <div className={styles.leftSection}>
          {pathname.startsWith('/chat') && (
            <button 
              className="md:hidden mr-2 p-2 -ml-2 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center"
              onClick={onMenuClick}
              aria-label="打开侧边栏"
            >
              <Menu size={20} />
            </button>
          )}
          <h1 className={`${styles.logo} !text-gray-900`}>NoteWithAI</h1>
        </div>

        {/* 中间导航菜单 */}
        <div className={styles.middleSection}>
          <nav
            className={`${styles.nav} !bg-transparent !border-none !p-0 !gap-2`}
            data-active-index={activeIndex}
            aria-label="主导航"
          >
            {/* 常驻“滑动高光底板”：默认停在当前激活项上，hover 另一项时滑过去 */}
            <span className={`${styles.navHoverPill} !hidden`} aria-hidden="true" />
            {menuItems.map(({ label, href }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.navItem} !rounded-lg hover:!bg-gray-100 !transition-colors ${isActive ? '!text-gray-900 !font-medium !bg-gray-100' : '!text-gray-500'}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 右侧用户信息 */}
        <div className={styles.rightSection}>
          {/* 仅在开发环境下显示旧版/新版视图切换入口 */}
          {process.env.NODE_ENV === 'development' && (
            <>
              {pathname === '/notes' && (
                <Link href="/notes/view" className={`${styles.extraLink} !text-gray-500 hover:!text-gray-900 !bg-transparent !border-none hover:!bg-gray-100`}>
                  进入新视图
                </Link>
              )}
              {pathname === '/notes/view' && (
                <Link href="/notes" className={`${styles.extraLink} !text-gray-500 hover:!text-gray-900 !bg-transparent !border-none hover:!bg-gray-100`}>
                  返回旧版
                </Link>
              )}
            </>
          )}
          {user && (
            <div className={styles.userSection}>
              <div 
                className={`${styles.userInfo} !bg-transparent !border-none hover:!bg-gray-100 !rounded-lg`}
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <span className={`${styles.userName} !text-gray-700`}>{user.username}</span>
                <svg 
                  className={`${styles.chevron} ${showUserMenu ? styles.chevronUp : ''} !text-gray-500`}
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
                <div className={`${styles.userMenu} !bg-white !shadow-lg !border !border-gray-100 !rounded-xl !py-2 !mt-2`}>
                  <div className={`${styles.userMenuHeader} !px-4 !py-2`}>
                    <div className={styles.userDetails}>
                      <span className={`${styles.userNameLarge} !text-gray-900 !font-semibold`}>{user.username}</span>
                      <span className={`${styles.userEmail} !text-gray-500 !text-xs`}>{user.email}</span>
                    </div>
                  </div>
                  
                  <div className={`${styles.userMenuDivider} !border-t !border-gray-100 !my-1`}></div>
                  
                  <Link href="/profile" className={`${styles.menuLink} !flex !items-center !gap-2 !px-4 !py-2 !text-sm !text-gray-700 hover:!bg-gray-50 hover:!text-gray-900 !transition-colors`} onClick={() => setShowUserMenu(false)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="!text-gray-400">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    个人中心
                  </Link>

                  <div className={`${styles.userMenuDivider} !border-t !border-gray-100 !my-1`}></div>
                  
                  <button onClick={handleLogout} className={`${styles.logoutButton} !flex !items-center !gap-2 !w-full !text-left !px-4 !py-2 !text-sm !text-red-600 hover:!bg-red-50 !transition-colors !bg-transparent !border-none`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="!text-red-500">
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

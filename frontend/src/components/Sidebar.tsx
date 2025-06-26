'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.scss';

const menuItems = [
  { label: '首页', href: '/notes' },
  { label: '聊天', href: '/chat' },
  { label: 'For me', href: '/for-me' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <h1 className={styles.logo}>记录</h1>
      <nav className={styles.nav}>
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
    </aside>
  );
}

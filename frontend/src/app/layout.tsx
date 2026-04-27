/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// frontend/src/app/layout.tsx
import '../styles/globals.scss';
import GlobalKeybindings from '../components/GlobalKeybindings';
import UUIDPolyfill from '../components/UUIDPolyfill';
import { Toaster } from 'sonner';
import type { Metadata } from 'next';
import Providers from './providers';
// 由于国内网络拉取 Google 字体常出现超时，这里移除 next/font/google 依赖
// 转而使用普通的 CSS 类配合系统字体作为默认策略

const interVariable = 'font-sans';
const jetbrainsMonoVariable = 'font-mono';

export const metadata: Metadata = {
  title: 'NoteWithAI',
  description: 'AI assisted note-taking app',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      {/* 主题背景/文字由 globals.scss 控制，避免被固定的 tailwind 背景色“压成纯色” */}
      <body className={`${interVariable} ${jetbrainsMonoVariable}`}>
        <Providers>
          <UUIDPolyfill />
          <GlobalKeybindings />
          <Toaster position="top-center" />
          {children}
        </Providers>
      </body>
    </html>
  );
}

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
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'NoteWithAI',
  description: 'AI assisted note-taking app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      {/* 主题背景/文字由 globals.scss 控制，避免被固定的 tailwind 背景色“压成纯色” */}
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <UUIDPolyfill />
        <GlobalKeybindings />
        <Toaster position="top-center" />
        {children}
      </body>
    </html>
  );
}

/*
Input: 页面内容、全局服务及工作区路由边界
Output: 公共Providers，普通用户页进入隔离工作区，认证和后台保持原样
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
import WorkspaceRoot from '../components/workspace/WorkspaceRoot';
// 由于国内网络拉取 Google 字体常出现超时，这里移除 next/font/google 依赖
// 转而使用普通的 CSS 类配合系统字体作为默认策略

const interVariable = 'font-sans';

export const metadata: Metadata = {
  title: 'NoteWithAI',
  description: 'AI assisted note-taking app',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      {/* 主题背景/文字由 globals.scss 控制，避免被固定的 tailwind 背景色“压成纯色” */}
      <body className={interVariable}>
        <Providers>
          <UUIDPolyfill />
          <GlobalKeybindings />
          <Toaster position="top-center" />
          <WorkspaceRoot>{children}</WorkspaceRoot>
        </Providers>
      </body>
    </html>
  );
}

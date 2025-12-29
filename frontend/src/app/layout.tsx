/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// frontend/src/app/layout.tsx
import '../styles/globals.css';
import GlobalKeybindings from '../components/GlobalKeybindings';
import UUIDPolyfill from '../components/UUIDPolyfill';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NoteWithAI',
  description: 'AI assisted note-taking app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900">
        <UUIDPolyfill />
        <GlobalKeybindings />
        {children}
      </body>
    </html>
  );
}

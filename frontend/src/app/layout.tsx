// frontend/src/app/layout.tsx
//import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NoteWithAI',
  description: 'AI assisted note-taking app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}

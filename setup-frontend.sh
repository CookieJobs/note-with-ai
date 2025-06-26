#!/bin/bash

echo "🚧 正在创建 frontend 目录结构..."

# 创建主目录结构
mkdir -p frontend/public
mkdir -p frontend/src/app/notes
mkdir -p frontend/src/app/chat
mkdir -p frontend/src/app/for-me
mkdir -p frontend/src/components
mkdir -p frontend/src/lib
mkdir -p frontend/src/styles

# 创建基础文件
touch frontend/public/favicon.ico
touch frontend/.env.local
touch frontend/next.config.js
touch frontend/tsconfig.json
touch frontend/package.json
touch frontend/README.md

# 创建 app 文件
cat <<EOF > frontend/src/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
EOF

cat <<EOF > frontend/src/app/page.tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/notes');
}
EOF

touch frontend/src/app/notes/page.tsx
touch frontend/src/app/chat/page.tsx
touch frontend/src/app/for-me/page.tsx

# 创建组件模板
touch frontend/src/components/NoteCard.tsx
touch frontend/src/components/ChatMessage.tsx
touch frontend/src/components/RecommendationItem.tsx

# 创建 utils & 样式
touch frontend/src/lib/api.ts
touch frontend/src/styles/globals.css

echo "✅ 前端结构创建完成！你可以进入 frontend 目录并继续开发。"


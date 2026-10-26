/*
Input: 当前路由与原页面
Output: 仅普通用户页面进入持久工作区，认证和后台沿用原页面
Pos: frontend/src/components/workspace
Note: 修改时同步本目录 README。
*/
'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import WorkspaceShell from './WorkspaceShell';
import { WorkspacePopstateBridge } from './WorkspacePopstateBridge';

export function isWorkspacePath(path: string) {
  return /^\/(notes|chat|inspiration|profile)(?:\/|$)/.test(path);
}

export default function WorkspaceRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Keep the event bridge mounted across authentication → workspace transitions.
  // Its empty subscription does nothing on excluded pages.
  return <WorkspacePopstateBridge>{isWorkspacePath(pathname) ? <WorkspaceShell pathname={pathname}>{children}</WorkspaceShell> : children}</WorkspacePopstateBridge>;
}

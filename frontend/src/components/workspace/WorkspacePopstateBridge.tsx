/*
Input: 始终挂载的路由边界与活动工作区的 history 保护订阅
Output: 比 Next 父 effect 更早建立的 popstate 桥；排除路由无活动处理
Pos: frontend/src/components/workspace
Note: 修改时同步本目录 README。
*/
'use client';

import { createContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

export const WorkspacePopstateBridgeContext = createContext<{
  subscribe: (handler: (event: PopStateEvent) => void) => () => void;
} | null>(null);

export function WorkspacePopstateBridge({ children }: { children: ReactNode }) {
  const subscriber = useRef<{ handler: (event: PopStateEvent) => void } | null>(null);
  const subscribe = useCallback((handler: (event: PopStateEvent) => void) => {
    const registration = { handler };
    subscriber.current = registration;
    return () => {
      if (subscriber.current === registration) subscriber.current = null;
    };
  }, []);
  const value = useMemo(() => ({ subscribe }), [subscribe]);
  useEffect(() => {
    // This boundary also mounts on auth/admin, before Next's parent effect.
    // Keep an empty forwarding listener there: no editor or history mutation.
    const onPopState = (event: PopStateEvent) => subscriber.current?.handler(event);
    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, []);
  return <WorkspacePopstateBridgeContext.Provider value={value}>{children}</WorkspacePopstateBridgeContext.Provider>;
}

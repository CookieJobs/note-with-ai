/*
Input: 已确定的当前用户 ID 和真实定期发现 API
Output: 唯一设置控制器；服务端确认后更新，隔离账户及迟到读取
Pos: frontend/src/hooks（灵感设置）
Note: 修改时同步 app/inspiration/README.md。
*/
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getInspirationSettings, setInspirationEnabled, type InspirationSettings } from '../services/inspirationService';
export type InspirationSettingsController = {
  settings: InspirationSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
};
type Owner = { userId?: string; active: boolean; read: number; saving: boolean };
type State = Pick<InspirationSettingsController, 'settings' | 'loading' | 'saving' | 'error'> & { owner: Owner };
const initial = (owner: Owner): State => ({ owner, settings: null, loading: !!owner.userId, saving: false, error: null });

// The shell owns the production instance. The standalone page mounts its own fallback only outside Workspace.
export function useInspirationSettings(userId?: string): InspirationSettingsController {
  const current = useRef<Owner>({ userId, active: true, read: 0, saving: false });
  if (current.current.userId !== userId) {
    current.current.active = false;
    current.current = { userId, active: true, read: 0, saving: false };
  }
  const owner = current.current;
  const [state, setState] = useState<State>(() => initial(owner));
  const refetch = useCallback(async () => {
    if (!owner.userId || !owner.active || owner.saving) return;
    const read = ++owner.read;
    setState((previous) => ({ ...(previous.owner === owner ? previous : initial(owner)), loading: true, error: null }));
    try {
      const settings = await getInspirationSettings();
      if (owner.active && current.current === owner && read === owner.read) {
        setState((previous) => ({ ...previous, owner, settings, loading: false, error: null }));
      }
    } catch {
      if (owner.active && current.current === owner && read === owner.read) {
        setState((previous) => ({ ...previous, owner, loading: false, error: '暂时无法加载定期发现设置。' }));
      }
    }
  }, [owner]);
  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!owner.userId || !owner.active || current.current !== owner || owner.saving) return false;
    owner.saving = true; // Synchronous lock also covers two calls before React renders.
    ++owner.read; // Any earlier GET is invalid from the moment a write starts.
    setState((previous) => ({ ...(previous.owner === owner ? previous : initial(owner)), saving: true, loading: false, error: null }));
    try {
      const settings = await setInspirationEnabled(enabled);
      if (!owner.active || current.current !== owner) return false;
      setState({ owner, settings, saving: false, loading: false, error: null });
      return true;
    } catch {
      if (owner.active && current.current === owner) {
        setState((previous) => ({ ...previous, owner, saving: false, error: '设置未能保存，请重试。' }));
      }
      return false;
    } finally {
      owner.saving = false;
    }
  }, [owner]);
  useEffect(() => {
    owner.active = true;
    setState(initial(owner));
    void refetch();
    return () => { owner.active = false; ++owner.read; };
  }, [owner, refetch]);
  const visible = state.owner === owner ? state : initial(owner);
  return { settings: visible.settings, loading: visible.loading, saving: visible.saving, error: visible.error, refetch, setEnabled };
}

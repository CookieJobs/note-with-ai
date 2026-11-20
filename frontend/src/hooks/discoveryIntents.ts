// Same-tab, owner-scoped user intent. Never used as authority for sources or saved results.
import { useCallback, useRef, useState } from 'react';
export interface DiscoveryIntent {
  text?: string; draftOpen?: boolean; operation?: {text: string; idempotencyKey: string};
  savedId?: string; feedback?: boolean; error?: string; stale?: boolean;
  retryOfRequestId?: string; retryEligibleRequestId?: string;
}
export function useDiscoveryIntents(owner: string) {
  const key = `note_discovery_intents_${owner}`;
  const [initial] = useState<Record<string, DiscoveryIntent>>(() => { try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; } });
  const values = useRef(initial);
  const [, rerender] = useState(0);
  const set = useCallback((id: string, patch: Partial<DiscoveryIntent>) => {
    let latest = values.current;
    try { latest = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch {}
    values.current = {...latest, [id]: {...latest[id], ...patch}};
    try { sessionStorage.setItem(key, JSON.stringify(values.current)); } catch {}
    rerender(value => value + 1);
  }, [key]);
  return { values: values.current, set };
}

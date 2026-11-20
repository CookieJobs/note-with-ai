// Authenticated discovery API; server owns eligibility, evidence and conversation binding.
import { authFetch } from '../utils/auth';
import type { IChat, INote } from '../types';
export interface DiscoveryEvidence { noteId: string; revision: number; title: string; noteDate: string; excerpt: string; hasImages: boolean }
export interface NoteDiscovery {
  id: string; kind: 'connection' | 'follow_up' | 'next_step'; title: string; observation: string;
  whyNow: string; qualification: string; suggestedAction: string; draft?: string;
  evidence: DiscoveryEvidence[]; status: 'ready' | 'stale' | 'dismissed' | 'completed';
  createdAt: string; exposedAt?: string; sessionId?: string; savedNoteId?: string;
}
export interface DiscoveryList {
  items: NoteDiscovery[]; available: boolean; automaticEnabled: boolean; timeZone: string;
  run: { status: 'idle' | 'queued' | 'running' | 'completed' | 'no_result' | 'budget_exhausted' | 'failed'; retryAt?: string; errorCode?: string };
}
export type DiscoveryFeedback = 'not_interested' | 'not_related' | 'already_finished';
export const discoveryOperationId = () => crypto.randomUUID();
export class DiscoveryApiError extends Error { constructor(message: string, public status: number, public code?: string, public retryEligible = false, public requestId?: string, public retryAt?: string) { super(message); } }
async function request<T>(path = '', options: RequestInit = {}): Promise<T> {
  const response = await authFetch(`/api/note-discoveries${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(75_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new DiscoveryApiError(payload?.message || payload?.error || '操作没有完成，请稍后重试。', response.status, payload?.code, payload?.retryEligible === true && payload?.code === 'CHAT_BUDGET_EXHAUSTED', payload?.requestId, typeof payload?.retryAt === 'string' ? payload.retryAt : undefined);
  return payload.data as T;
}
export const noteDiscoveries = {
  list: (signal?: AbortSignal, history = false, admit = false) => {
    const query = new URLSearchParams({ admit: String(admit), history: String(history) });
    if (admit && !history) {
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timeZone) query.set('timeZone', timeZone);
      } catch { /* The server uses its default when the browser cannot resolve a zone. */ }
    }
    return request<DiscoveryList>(`?${query}`, { signal });
  },
  run: (idempotencyKey: string) => request('/run', { method: 'POST', body: JSON.stringify({ idempotencyKey }) }),
  preferences: (automaticEnabled: boolean) => request<Pick<DiscoveryList, 'automaticEnabled' | 'available' | 'timeZone'>>('/preferences', { method: 'PATCH', body: JSON.stringify({ automaticEnabled }) }),
  feedback: (id: string, kind: DiscoveryFeedback) => request(`/${id}/feedback`, { method: 'POST', body: JSON.stringify({ kind }) }),
  undo: (id: string) => request(`/${id}/feedback`, { method: 'DELETE' }),
  session: (id: string, retryOfRequestId?: string) => request<{session: IChat; reused: boolean}>(`/${id}/session`, { method: 'POST', body: JSON.stringify(retryOfRequestId ? { retryOfRequestId } : {}) }),
  save: (id: string, payload: { text: string; idempotencyKey: string }) => request<{note: INote; discovery: NoteDiscovery}>(`/${id}/save`, { method: 'POST', body: JSON.stringify(payload) }),
};

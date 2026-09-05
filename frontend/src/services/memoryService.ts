import { authFetch } from '../utils/auth';

export type MemoryInsight = {
  id: string;
  displayStatement: string;
  status: string;
  confidence: string;
  evidence: Array<{ noteId: string; noteRevision: number; excerpt: string; capturedAt: string }>;
};

async function unwrap(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload.data;
}

export async function getMemoryInsights(): Promise<MemoryInsight[]> {
  return (await unwrap(await authFetch('/api/memory-insights'))).insights;
}
export async function generateMemoryInsights() {
  return unwrap(await authFetch('/api/memory-insights/generate', { method: 'POST' })) as Promise<{ created: number }>;
}
export async function confirmMemoryInsight(id: string) {
  return unwrap(await authFetch('/api/memory-insights/' + id + '/confirm', { method: 'POST' }));
}
export async function correctMemoryInsight(id: string, correction: string) {
  return unwrap(await authFetch('/api/memory-insights/' + id + '/correction', { method: 'PATCH', body: JSON.stringify({ correction }) }));
}
export async function deleteMemoryInsight(id: string) {
  return unwrap(await authFetch('/api/memory-insights/' + id, { method: 'DELETE' }));
}
export async function getNoteAiPreference(noteId: string): Promise<{ noteId: string; included: boolean }> {
  return unwrap(await authFetch('/api/note-ai-preferences/' + noteId));
}
export async function saveNoteAiPreference(noteId: string, included: boolean): Promise<{ noteId: string; included: boolean }> {
  return unwrap(await authFetch('/api/note-ai-preferences/' + noteId, { method: 'PUT', body: JSON.stringify({ included }) }));
}

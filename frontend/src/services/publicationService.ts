import { authFetch } from '../utils/auth';

export type Publication = { id: string; slug: string; title?: string; status: 'active' | 'revoked'; sourceRevision: number; updatedAt?: string };
async function unwrap(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload.data;
}
export async function listPublications(): Promise<Publication[]> {
  return (await unwrap(await authFetch('/api/publications/mine'))).publications;
}
export async function createPublication(noteId: string) {
  return (await unwrap(await authFetch('/api/publications', { method: 'POST', body: JSON.stringify({ noteId }) }))).publication;
}
export async function refreshPublication(id: string) {
  return (await unwrap(await authFetch('/api/publications/' + id + '/snapshot', { method: 'PATCH' }))).publication;
}
export async function revokePublication(id: string) {
  return unwrap(await authFetch('/api/publications/' + id, { method: 'DELETE' }));
}


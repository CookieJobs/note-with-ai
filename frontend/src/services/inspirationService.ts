import { authFetch } from '../utils/auth';
async function unwrap(response: Response) {
  const payload = await response.json();
  if (!response.ok) { const error: any = new Error(payload.error || '请求失败'); error.code = payload.code; throw error; }
  return payload.data;
}
export async function getInspirations() { return (await unwrap(await authFetch('/api/inspirations'))).inspirations as any[]; }
export async function requestInspiration() { return unwrap(await authFetch('/api/inspirations/generate', { method: 'POST' })); }
export async function getInspirationJob(id: string) { return (await unwrap(await authFetch('/api/inspirations/jobs/' + id))).job; }
export async function updateInspirationStatus(id: string, status: 'read' | 'saved' | 'dismissed') {
  return unwrap(await authFetch('/api/inspirations/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) }));
}
export async function getInspirationSettings() {
  return unwrap(await authFetch('/api/inspiration-settings')) as Promise<{ proactiveEnabled: boolean }>;
}
export async function saveInspirationSettings(proactiveEnabled: boolean) {
  return unwrap(await authFetch('/api/inspiration-settings', { method: 'PUT', body: JSON.stringify({ proactiveEnabled }) })) as Promise<{ proactiveEnabled: boolean }>;
}

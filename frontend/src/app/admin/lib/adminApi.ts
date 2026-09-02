import { AdminApiError } from './contracts';
export async function adminFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) { let body: any = {}; try { body = await response.json(); } catch {} if (response.status === 401 && typeof window !== 'undefined') window.location.href = '/admin/login'; throw new AdminApiError(response.status, body.code, body.message || '请求失败'); }
  const body = await response.json(); return body.data as T;
}
export const adminPost = <T>(url: string, body: unknown) => adminFetch<T>(url, { method: 'POST', body: JSON.stringify(body) });
export const adminPatch = <T>(url: string, body: unknown) => adminFetch<T>(url, { method: 'PATCH', body: JSON.stringify(body) });

import { AdminApiError } from './contracts';
export async function adminFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try { const parsed: unknown = await response.json(); if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>; } catch { /* non-json error */ }
    if (response.status === 401 && typeof window !== 'undefined') window.location.href = '/admin/login';
    throw new AdminApiError(response.status, typeof body.code === 'string' ? body.code : undefined, typeof body.message === 'string' ? body.message : '请求失败');
  }
  const body: unknown = await response.json();
  return (body && typeof body === 'object' && 'data' in body ? (body as { data: T }).data : body as T);
}
export const adminPost = <T>(url: string, body: unknown) => adminFetch<T>(url, { method: 'POST', body: JSON.stringify(body) });
export const adminPatch = <T>(url: string, body: unknown) => adminFetch<T>(url, { method: 'PATCH', body: JSON.stringify(body) });

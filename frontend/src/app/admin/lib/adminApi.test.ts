import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminFetch, adminPatch, adminPost } from './adminApi';

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('admin API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('always uses cookie credentials and never adds Authorization or local storage state', async () => {
    const fetch = vi.fn().mockImplementation(
      () => Promise.resolve(response({ success: true, data: { ok: true } })),
    );
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('fetch', fetch);

    await expect(adminFetch<{ ok: boolean }>('/api/admin/example', {
      headers: { 'X-Request-Context': 'test' },
    })).resolves.toEqual({ ok: true });

    const [, options] = fetch.mock.calls[0] as [string, RequestInit];
    expect(options.credentials).toBe('include');
    expect(new Headers(options.headers).get('Authorization')).toBeNull();
    expect(new Headers(options.headers).get('X-Request-Context')).toBe('test');
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('serializes canonical POST and PATCH request bodies', async () => {
    const fetch = vi.fn().mockImplementation(
      () => Promise.resolve(response({ success: true, data: { ok: true } })),
    );
    vi.stubGlobal('fetch', fetch);

    await adminPost('/api/admin/action', { reason: 'valid reason' });
    await adminPatch('/api/admin/resource', { status: 'resolved' });

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/admin/action', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ reason: 'valid reason' }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/resource', expect.objectContaining({
      method: 'PATCH',
      credentials: 'include',
      body: JSON.stringify({ status: 'resolved' }),
    }));
  });

  it('redirects a 401 to the independent admin login and throws a typed error', async () => {
    const location = { href: '/admin/users' };
    vi.stubGlobal('window', { location });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      success: false,
      code: 'ADMIN_SESSION_INVALID',
      message: '管理员会话无效',
    }, { status: 401 })));

    await expect(adminFetch('/api/admin/users')).rejects.toMatchObject({
      status: 401,
      code: 'ADMIN_SESSION_INVALID',
    });
    expect(location.href).toBe('/admin/login');
  });

  it('keeps a 403 inline by throwing without redirecting', async () => {
    const location = { href: '/admin/audit' };
    vi.stubGlobal('window', { location });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      success: false,
      message: '无权限访问',
    }, { status: 403 })));

    await expect(adminFetch('/api/admin/audit')).rejects.toMatchObject({ status: 403 });
    expect(location.href).toBe('/admin/audit');
  });
});

import { AdminApiError } from './contracts';

type ErrorEnvelope = {
  code?: unknown;
  message?: unknown;
};

function buildHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.delete('Authorization');
  return headers;
}

async function readError(response: Response): Promise<ErrorEnvelope> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? body as ErrorEnvelope : {};
  } catch {
    return {};
  }
}

export async function adminFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: buildHeaders(options),
  });

  if (!response.ok) {
    const body = await readError(response);
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/admin/login';
    }
    throw new AdminApiError(
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
      typeof body.message === 'string' ? body.message : '请求失败',
    );
  }

  const body: unknown = await response.json();
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export function adminPost<T>(url: string, body?: unknown): Promise<T> {
  return adminFetch<T>(url, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function adminPatch<T>(url: string, body: unknown): Promise<T> {
  return adminFetch<T>(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export { AdminApiError };

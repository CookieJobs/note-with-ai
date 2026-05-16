/*
Input: localStorage token/user + relative or absolute request URL
Output: auth helpers and authenticated fetch wrapper for frontend API calls
Pos: frontend/src/utils
Note: Prefer same-origin `/api/...` requests so Next.js rewrites can proxy to backend safely.
*/
// frontend/src/utils/auth.ts

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  createdAt: string;
}

// 获取存储的token（安全获取）
export const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('token');
  if (!token || token === 'undefined' || token === 'null') {
    if (token) localStorage.removeItem('token');
    return null;
  }
  return token;
};

// 获取存储的用户信息（安全解析）
export const getUser = (): User | null => {
  if (typeof window === 'undefined') return null;
  const userStr = localStorage.getItem('user');
  if (!userStr || userStr === 'undefined' || userStr === 'null') {
    // 清理不合法的值，避免后续再次报错
    if (userStr) localStorage.removeItem('user');
    return null;
  }
  try {
    const parsed = JSON.parse(userStr);
    // 仅当解析结果为对象时才返回
    return parsed && typeof parsed === 'object' ? (parsed as User) : null;
  } catch (e) {
    // 当本地存储里是无效 JSON（例如字符串 'undefined'）时，避免抛错
    localStorage.removeItem('user');
    return null;
  }
};

// 检查用户是否已登录
export const isAuthenticated = (): boolean => {
  return !!getToken();
};

// 登出
export const logout = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  Object.keys(sessionStorage)
    .filter((key) => key.startsWith('care_intro_cache'))
    .forEach((key) => sessionStorage.removeItem(key));
  window.location.href = '/auth';
};

// 获取带认证头的fetch配置
export const getAuthHeaders = (): HeadersInit => {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };
};

const resolveAuthUrl = (url: string): string => {
  // Keep same-origin API calls on the frontend origin so Next rewrites can proxy
  // them to the backend. This avoids direct browser requests to localhost:3001.
  if (!url || url.startsWith('http')) return url;
  if (url.startsWith('/api/')) return url;

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
  return baseUrl ? `${baseUrl}${url}` : url;
};

// 认证的fetch请求（统一处理401/403）
export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const fullUrl = resolveAuthUrl(url);

  const response = await fetch(fullUrl, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers
    }
  });

  // 如果返回401或403，说明token过期/无效或无权限，自动登出
  if (response.status === 401 || response.status === 403) {
    logout();
    throw new Error('认证失败或权限不足，请重新登录');
  }

  return response;
};

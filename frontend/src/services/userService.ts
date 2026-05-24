import { authFetch } from '../utils/auth';

export const updateProfile = async (data: {
  username?: string;
  avatar?: string;
}): Promise<{ id: string; username?: string; email: string; avatar?: string }> => {
  const response = await authFetch('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '更新失败');
  }
  const body = await response.json();
  return body.data.user;
};

export const changePassword = async (data: {
  oldPassword: string;
  newPassword: string;
}): Promise<void> => {
  const response = await authFetch('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '密码修改失败');
  }
};

/*
Input: 改密请求发起时的用户与登录 token
Output: 成功后结束同一登录会话，表单卸载不取消，不影响后来登录的会话
Pos: frontend/src/utils
*/
import { getToken, getUser, logout } from './auth';

export function schedulePasswordSessionLogout(userId: string, token: string | null): void {
  if (!token) return;
  // This is a session consequence, not a component effect. Never capture passwords.
  setTimeout(() => {
    if (getUser()?.id === userId && getToken() === token) logout();
  }, 1500);
}

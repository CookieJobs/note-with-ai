// utils/userId.ts
export function getUserId(): string {
  let id = localStorage.getItem('user_id');
  if (!id) {
    id = crypto.randomUUID(); // 或使用第三方库如 uuid.v4()
    localStorage.setItem('user_id', id);
  }
  return id;
}

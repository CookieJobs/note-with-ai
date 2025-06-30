// frontend/src/utils/uuid.ts
export function getOrCreateUUID(): string {
  let uuid = localStorage.getItem('user_uuid');
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem('user_uuid', uuid);
    console.log('🚀 新用户生成 UUID:', uuid);
  }
  return uuid;
}

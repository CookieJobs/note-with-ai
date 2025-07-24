// frontend/src/utils/uuid.ts
export function getOrCreateUUID(): string | null {
  if (typeof window === 'undefined') return null; // SSR 阶段不执行

  let uuid = localStorage.getItem('user_uuid');
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem('user_uuid', uuid);
    console.log('🚀 新用户生成 UUID:', uuid);
  }
  return uuid;
}

// 生成随机UUID
export function generateUUID(): string {
  if (typeof window !== 'undefined' && window.crypto) {
    return crypto.randomUUID();
  }
  // 备用方案，用于不支持crypto.randomUUID()的环境
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

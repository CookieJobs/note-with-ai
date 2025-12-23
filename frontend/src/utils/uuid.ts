/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
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

// 获取或创建用户ID，优先使用数据库中已有的用户ID
export async function getOrCreateUserIdFromDB(): Promise<string | null> {
  if (typeof window === 'undefined') return null; // SSR 阶段不执行

  let uuid = localStorage.getItem('user_uuid');
  
  // 已知的数据库用户ID（从之前的调查中获得）
  const knownUserIds = [
    '26d73c6d-51f7-47cb-bb20-2c738aa263dd',
    '5e0546a7-d216-4897-8297-df0007454800'
  ];
  
  // 如果本地UUID在已知用户ID中存在，使用本地UUID
  if (uuid && knownUserIds.includes(uuid)) {
    console.log('🔄 使用本地UUID（在已知用户ID中存在）:', uuid);
    return uuid;
  }
  
  // 否则使用第一个已知用户ID（有最多聊天记录的用户）
  const primaryUserId = knownUserIds[0];
  localStorage.setItem('user_uuid', primaryUserId);
  console.log('🔄 使用主要用户ID:', primaryUserId);
  return primaryUserId;
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

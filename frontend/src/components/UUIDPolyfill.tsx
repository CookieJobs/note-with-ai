'use client';

import { useEffect } from 'react';

export default function UUIDPolyfill() {
  if (typeof window !== 'undefined') {
    // 确保 window.crypto 存在
    if (!window.crypto) {
      // @ts-ignore
      window.crypto = window.msCrypto || {};
    }

    // Polyfill randomUUID 如果它不存在 (例如在 HTTP 环境下)
    if (!window.crypto.randomUUID) {
      console.log('🛡️ Polyfilling crypto.randomUUID for insecure context');
      // @ts-ignore
      window.crypto.randomUUID = function(): `${string}-${string}-${string}-${string}-${string}` {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        }) as `${string}-${string}-${string}-${string}-${string}`;
      };
    }
  }
  return null;
}

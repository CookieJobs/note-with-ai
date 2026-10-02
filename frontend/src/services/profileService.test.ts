import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProfileAnalysis, getStats, triggerProfileAnalysis } from './profileService';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch }));

describe('profileService', () => {
  beforeEach(() => authFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));

  it('画像取得只读取画像分析端点', async () => {
    await getProfileAnalysis();
    expect(authFetch).toHaveBeenCalledExactlyOnceWith('/api/profile/analysis', undefined);
  });

  it('画像生成只向画像分析端点发送 POST', async () => {
    await triggerProfileAnalysis();
    expect(authFetch).toHaveBeenCalledExactlyOnceWith('/api/profile/analysis', { method: 'POST' });
  });

  it('统计只读取统计端点', async () => {
    await getStats();
    expect(authFetch).toHaveBeenCalledExactlyOnceWith('/api/user/stats', undefined);
  });
});

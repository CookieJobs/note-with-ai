import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../utils/auth';
import { getProfileTopics, retryFailedProfileTopics } from './profileTopicsService';

vi.mock('../utils/auth', () => ({ authFetch: vi.fn() }));
const mockedAuthFetch = vi.mocked(authFetch);

describe('profileTopicsService', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('按所选范围读取话题 DTO', async () => {
    mockedAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { scope: 'year' } }) } as Response);
    await expect(getProfileTopics('year')).resolves.toEqual({ scope: 'year' });
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/profile/topics?scope=year', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('人工重试使用 retry POST 和选定范围', async () => {
    mockedAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { acceptedCount: 1 } }) } as Response);
    await expect(retryFailedProfileTopics('sixMonths')).resolves.toEqual({ acceptedCount: 1 });
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/profile/topics/retry', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ scope: 'sixMonths' }),
    }));
  });

  it('网络请求超时后结束而不永久等待', async () => {
    vi.useFakeTimers();
    mockedAuthFetch.mockReturnValue(new Promise<Response>(() => undefined));
    const request = getProfileTopics('all');
    const assertion = expect(request).rejects.toThrow('Request timed out');
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
  });

  it('整个响应体读取都受超时约束', async () => {
    vi.useFakeTimers();
    mockedAuthFetch.mockResolvedValue({ ok: true, json: () => new Promise<unknown>(() => undefined) } as Response);
    const assertion = expect(getProfileTopics('all')).rejects.toThrow('Request timed out');
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
  });

  it('signal 已取消时不发送请求', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getProfileTopics('all', controller.signal)).rejects.toThrow('Request aborted');
    expect(mockedAuthFetch).not.toHaveBeenCalled();
  });
});

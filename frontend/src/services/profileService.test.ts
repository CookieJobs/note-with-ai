import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../utils/auth';
import { getProfileAnalysis, getStats, triggerProfileAnalysis } from './profileService';

vi.mock('../utils/auth', () => ({ authFetch: vi.fn() }));
const mockedAuthFetch = vi.mocked(authFetch);

describe('profileService request timeout', () => {
  beforeEach(() => { mockedAuthFetch.mockReset(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('profile GET preserves its endpoint and forwards an optional signal', async () => {
    mockedAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { profileStatus: 'idle' } }) } as Response);
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(getProfileAnalysis(controller.signal)).resolves.toMatchObject({ profileStatus: 'idle' });
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/profile/analysis', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const abortListener = addListener.mock.calls.find(([type]) => type === 'abort')?.[1];
    expect(abortListener).toBeDefined();
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', abortListener);
  });

  it('profile POST preserves its endpoint and method while forwarding an optional signal', async () => {
    mockedAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { accepted: true } }) } as Response);
    const controller = new AbortController();
    await expect(triggerProfileAnalysis(controller.signal)).resolves.toMatchObject({ accepted: true });
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/profile/analysis', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));
  });

  it('stats GET preserves its endpoint and forwards an optional signal', async () => {
    mockedAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { totalNotes: 5, notesThisMonth: 2 } }) } as Response);
    const controller = new AbortController();
    await expect(getStats(controller.signal)).resolves.toEqual({ totalNotes: 5, notesThisMonth: 2 });
    expect(mockedAuthFetch).toHaveBeenCalledWith('/api/user/stats', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each([
    ['profile GET', () => getProfileAnalysis()],
    ['profile POST', () => triggerProfileAnalysis()],
    ['stats GET', () => getStats()],
  ])('%s fetch hangs时有限超时结束', async (_name, call) => {
    mockedAuthFetch.mockReturnValue(new Promise<Response>(() => undefined));
    let rejected = false;
    void call().catch(() => { rejected = true; });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(rejected).toBe(true);
  });

  it.each([
    ['profile GET', () => getProfileAnalysis()],
    ['profile POST', () => triggerProfileAnalysis()],
    ['stats GET', () => getStats()],
  ])('%s JSON body hangs时仍受整体超时约束', async (_name, call) => {
    mockedAuthFetch.mockResolvedValue({ ok: true, json: () => new Promise<unknown>(() => undefined) } as Response);
    let rejected = false;
    void call().catch(() => { rejected = true; });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(rejected).toBe(true);
  });

  it('already-aborted signal 不向网络层发送请求', async () => {
    const controller = new AbortController();
    controller.abort();
    await getProfileAnalysis(controller.signal).catch(() => undefined);
    expect(mockedAuthFetch).not.toHaveBeenCalled();
  });

  it('请求中取消会立即终止并清理caller signal监听器', async () => {
    mockedAuthFetch.mockReturnValue(new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    let rejected = false;
    const request = getProfileAnalysis(controller.signal).catch(() => { rejected = true; });
    controller.abort();
    await request;
    expect(rejected).toBe(true);
    const abortListener = addListener.mock.calls.find(([type]) => type === 'abort')?.[1];
    expect(abortListener).toBeDefined();
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', abortListener);
  });
});

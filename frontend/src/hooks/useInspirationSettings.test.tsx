import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInspirationSettings } from './useInspirationSettings';
import type { InspirationSettings } from '../services/inspirationService';
const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../services/inspirationService', () => ({ getInspirationSettings: get, setInspirationEnabled: put }));
const settings = (enabled = false): InspirationSettings => ({ enabled, consentedAt: enabled ? '2026-10-25T00:00:00Z' : null, nextEligibleAt: null, lastAttemptAt: null, lastStatus: null, lastReason: null, lastContextReason: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
describe('useInspirationSettings', () => {
  beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue(settings()); put.mockResolvedValue(settings(true)); });
  it('waits for the real PUT and rejects immediate duplicate submissions', async () => {
    const pending = deferred<InspirationSettings>(); put.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useInspirationSettings('u1'));
    await waitFor(() => expect(result.current.settings?.enabled).toBe(false));
    let first!: Promise<boolean>; let duplicate!: Promise<boolean>;
    act(() => { first = result.current.setEnabled(true); duplicate = result.current.setEnabled(true); });
    expect(result.current.settings?.enabled).toBe(false); expect(result.current.saving).toBe(true);
    await expect(duplicate).resolves.toBe(false); expect(put).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(settings(true)); await first; });
    expect(result.current.settings?.enabled).toBe(true); expect(result.current.saving).toBe(false);
  });
  it('preserves the server value when a PUT fails and allows retry', async () => {
    get.mockResolvedValue(settings(true)); put.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useInspirationSettings('u1'));
    await waitFor(() => expect(result.current.settings?.enabled).toBe(true));
    await act(async () => { expect(await result.current.setEnabled(false)).toBe(false); });
    expect(result.current.settings?.enabled).toBe(true); expect(result.current.error).toMatch(/未能保存/); expect(result.current.saving).toBe(false);
    put.mockResolvedValueOnce(settings(false));
    await act(async () => { expect(await result.current.setEnabled(false)).toBe(true); });
    expect(result.current.settings?.enabled).toBe(false);
  });
  it('ignores a GET that arrives after a successful PUT', async () => {
    const late = deferred<InspirationSettings>(); get.mockReturnValueOnce(late.promise);
    const { result } = renderHook(() => useInspirationSettings('u1'));
    await act(async () => { await result.current.setEnabled(true); });
    await act(async () => { late.resolve(settings(false)); await late.promise; });
    expect(result.current.settings?.enabled).toBe(true); expect(result.current.loading).toBe(false);
  });
  it('ignores GET and PUT responses owned by the previous user', async () => {
    const lateGet = deferred<InspirationSettings>(); const latePut = deferred<InspirationSettings>();
    get.mockReturnValueOnce(lateGet.promise).mockResolvedValueOnce(settings(false)); put.mockReturnValue(latePut.promise);
    const { result, rerender } = renderHook(({ id }) => useInspirationSettings(id), { initialProps: { id: 'u1' } });
    let write!: Promise<boolean>; act(() => { write = result.current.setEnabled(true); });
    rerender({ id: 'u2' }); await waitFor(() => expect(result.current.settings?.enabled).toBe(false));
    await act(async () => { lateGet.resolve(settings(true)); latePut.resolve(settings(true)); await write; });
    expect(result.current.settings?.enabled).toBe(false); expect(result.current.saving).toBe(false); expect(result.current.error).toBeNull();
  });
  it('does not request settings until identity is known', async () => {
    const { result } = renderHook(() => useInspirationSettings());
    expect(get).not.toHaveBeenCalled(); expect(result.current.settings).toBeNull();
    await act(async () => { expect(await result.current.setEnabled(true)).toBe(false); });
    expect(put).not.toHaveBeenCalled();
  });
});

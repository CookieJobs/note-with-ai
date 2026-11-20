import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCOVERY_POLL_LIMIT, DISCOVERY_POLL_MS, useNoteDiscoveries } from './useNoteDiscoveries';
import { noteDiscoveries } from '../services/noteDiscoveries';
vi.mock('../services/noteDiscoveries', () => ({noteDiscoveries: {list: vi.fn()}}));
const running = {items:[], available:true, automaticEnabled:true, timeZone:'Asia/Shanghai',run:{status:'running' as const}};
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(noteDiscoveries.list).mockResolvedValue(running); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('discovery polling', () => {
 it('bounds read-only polling and cancels timers on unmount', async () => {
  const view = renderHook(() => useNoteDiscoveries('u'));
  await act(async () => {});
  for(let i=0;i<DISCOVERY_POLL_LIMIT+2;i++) await act(async () => {await vi.advanceTimersByTimeAsync(DISCOVERY_POLL_MS);});
  expect(noteDiscoveries.list).toHaveBeenCalledTimes(DISCOVERY_POLL_LIMIT+1);
  expect(view.result.current.paused).toBe(true);
  view.unmount();
  await vi.advanceTimersByTimeAsync(DISCOVERY_POLL_MS*2);
  expect(noteDiscoveries.list).toHaveBeenCalledTimes(DISCOVERY_POLL_LIMIT+1);
 });
 it('pauses while hidden and aborts the active read', async () => {
  const view = renderHook(() => useNoteDiscoveries('u'));
  await act(async () => {});
  const signal = vi.mocked(noteDiscoveries.list).mock.calls[0][0];
  vi.spyOn(document,'hidden','get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(signal?.aborted).toBe(true);
  await act(async () => {await vi.advanceTimersByTimeAsync(20000);});
  expect(noteDiscoveries.list).toHaveBeenCalledTimes(1);
  view.unmount();
 });
});

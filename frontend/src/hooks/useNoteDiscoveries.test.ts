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

it('admits only on initial visible visit and excludes superseded or mutation-obsolete same-owner reads', async () => {
 let late!: (value: typeof running)=>void;
 const view=renderHook(()=>useNoteDiscoveries('u'));
 await act(async()=>{});
 expect(vi.mocked(noteDiscoveries.list).mock.calls[0][2]).toBe(true);
 vi.mocked(noteDiscoveries.list).mockImplementationOnce(()=>new Promise(r=>{late=r;}));
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(vi.mocked(noteDiscoveries.list).mock.calls[1][2]).toBe(false);
 act(()=>view.result.current.update(data=>({...data,automaticEnabled:false})));
 await act(async()=>late(running));
 expect(view.result.current.data?.automaticEnabled).toBe(false);
 let hiddenLate!: (value: typeof running)=>void;
 vi.mocked(noteDiscoveries.list).mockImplementationOnce(()=>new Promise(r=>{hiddenLate=r;}));
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true);
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 await act(async()=>hiddenLate(running));
 expect(view.result.current.data?.automaticEnabled).toBe(false);
 hidden.mockReturnValue(false);
 view.unmount();
});

it('retries initial admission after failure or unavailable feature, and consumes it only on a current available response', async () => {
 vi.mocked(noteDiscoveries.list).mockRejectedValueOnce(new Error('请求未送达')).mockResolvedValueOnce({...running,available:false}).mockResolvedValue(running);
 const view=renderHook(()=>useNoteDiscoveries('initial-retry'));
 await act(async()=>{});
 expect(view.result.current.error).toBeTruthy();
 act(()=>view.result.current.reload());await act(async()=>{});
 expect(view.result.current.data?.available).toBe(false);
 act(()=>view.result.current.reload());await act(async()=>{});
 expect(vi.mocked(noteDiscoveries.list).mock.calls.slice(0,3).map(call=>call[2])).toEqual([true,true,true]);
 await act(async()=>{await vi.advanceTimersByTimeAsync(DISCOVERY_POLL_MS);});
 expect(vi.mocked(noteDiscoveries.list).mock.calls[3][2]).toBe(false);
 view.unmount();
});
it('does not consume admission from an aborted hidden initial response', async () => {
 let finish!: (value: typeof running)=>void;
 vi.mocked(noteDiscoveries.list).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=renderHook(()=>useNoteDiscoveries('hidden-initial'));
 const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true);
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 await act(async()=>finish(running));
 hidden.mockReturnValue(false);
 act(()=>document.dispatchEvent(new Event('visibilitychange')));await act(async()=>{});
 expect(vi.mocked(noteDiscoveries.list).mock.calls.slice(0,2).map(call=>call[2])).toEqual([true,true]);
 view.unmount();
});

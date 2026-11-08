import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useNoteCalendar } from './useNoteCalendar';
const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../../../utils/auth', () => ({ authFetch }));
const reply = (month: string, count = 1) => ({ ok: true, json: async () => ({ success: true, data: { month, timezone: 'Asia/Shanghai', noteCount: count, recordedDayCount: count ? 1 : 0, days: count ? [{ date: month + '-01', count }] : [] } }) });
beforeEach(() => authFetch.mockReset());
it('keeps months and accounts isolated from late calendar responses', async () => {
  let old!: (v: unknown) => void;
  authFetch.mockReturnValueOnce(new Promise(r => { old = r; })).mockResolvedValue(reply('2026-10', 0));
  const { result, rerender } = renderHook(({ user, month }) => useNoteCalendar(user, month, 0), { initialProps: { user: 'A', month: '2026-11' } });
  rerender({ user: 'B', month: '2026-10' });
  await waitFor(() => expect(result.current.data?.noteCount).toBe(0));
  await act(async () => old(reply('2026-11', 20)));
  expect(result.current.data?.month).toBe('2026-10');
  expect(result.current.data?.noteCount).toBe(0);
});
it('caches months, refreshes after writes and distinguishes errors from zero', async () => {
  authFetch.mockResolvedValue(reply('2026-11', 0));
  const { result, rerender } = renderHook(({ version }) => useNoteCalendar('A', '2026-11', version), { initialProps: { version: 0 } });
  await waitFor(() => expect(result.current.data?.noteCount).toBe(0));
  authFetch.mockRejectedValueOnce(Error('offline'));
  rerender({ version: 1 });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  authFetch.mockResolvedValue(reply('2026-11', 3));
  await act(async () => result.current.retry());
  expect(result.current.data?.noteCount).toBe(3);
  expect(result.current.error).toBeNull();
});

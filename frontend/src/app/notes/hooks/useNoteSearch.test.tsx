import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteSearch } from './useNoteSearch';
const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../../../utils/auth', () => ({ authFetch }));
const note = (id: string) => ({ _id: id, title: id, content: id, revision: 1 });
const reply = (ids: string[], cursor: string | null = null) => ({ ok: true, json: async () => ({ success: true, data: { notes: ids.map(note), pageInfo: { hasMore: !!cursor, nextCursor: cursor } } }) });
beforeEach(() => authFetch.mockReset());
describe('independent read-only note search', () => {
  it('does not request a whole library for empty search, paginates and deduplicates literal results', async () => {
    authFetch.mockResolvedValueOnce(reply(['a'], 'next')).mockResolvedValueOnce(reply(['a', 'b']));
    const { result, rerender } = renderHook(({ q }) => useNoteSearch('A', q, 0), { initialProps: { q: '' } });
    expect(authFetch).not.toHaveBeenCalled();
    rerender({ q: '[a].*' });
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.notes.map(n => n._id)).toEqual(['a', 'b']);
    expect(authFetch.mock.calls[1][0]).toBe('/api/notes?q=%5Ba%5D.*&cursor=next');
    rerender({ q: '' }); expect(result.current.notes).toEqual([]);
  });
  it('ignores old query and old account responses even if fetch ignores cancellation', async () => {
    let resolve!: (v: unknown) => void;
    authFetch.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(reply(['B']));
    const { result, rerender } = renderHook(({ userId, q }) => useNoteSearch(userId, q, 0), { initialProps: { userId: 'A', q: 'one' } });
    rerender({ userId: 'B', q: 'two' });
    await waitFor(() => expect(result.current.notes[0]?._id).toBe('B'));
    await act(async () => resolve(reply(['A'])));
    expect(result.current.notes.map(n => n._id)).toEqual(['B']);
  });
  it('keeps loaded pages when revisiting a query and refreshes after a successful write', async () => {
    authFetch.mockResolvedValue(reply(['first']));
    const { result, rerender } = renderHook(({ q, version }) => useNoteSearch('A', q, version), { initialProps: { q: 'one', version: 0 } });
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    rerender({ q: '', version: 0 }); rerender({ q: 'one', version: 0 });
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(authFetch).toHaveBeenCalledTimes(1);
    authFetch.mockResolvedValue(reply([]));
    rerender({ q: 'one', version: 1 });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.notes).toEqual([]);
  });
  it('distinguishes failures from zero matches and can retry', async () => {
    authFetch.mockRejectedValueOnce(Error('offline')).mockResolvedValue(reply([]));
    const { result } = renderHook(() => useNoteSearch('A', 'needle', 0));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    await act(async () => { await result.current.retry(); });
    expect(result.current.error).toBeNull(); expect(result.current.notes).toEqual([]);
  });
});

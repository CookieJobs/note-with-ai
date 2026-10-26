import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusedSourceNote } from './useFocusedSourceNote';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../../../utils/auth', () => ({ authFetch }));

const note = (id: string) => ({ _id: id, title: '', content: '原文', contentText: '原文', revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' });
const response = (id: string) => ({ ok: true, status: 200, json: async () => ({ success: true, data: { note: note(id) } }) });

describe('focused source note', () => {
  beforeEach(() => authFetch.mockReset());

  it('loads one paginated-out source by ID and does not refetch on unrelated rerenders', async () => {
    authFetch.mockResolvedValue(response('outside'));
    const { result, rerender } = renderHook(({ userId, inFeed }) => useFocusedSourceNote(userId, 'outside', inFeed), { initialProps: { userId: 'A', inFeed: false } });
    await waitFor(() => expect(result.current.state?.note?._id).toBe('outside'));
    expect(authFetch).toHaveBeenCalledWith('/api/notes/outside', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    rerender({ userId: 'A', inFeed: false });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('ignores late responses from another account and reports removal', async () => {
    let resolveA!: (value: unknown) => void;
    authFetch.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    authFetch.mockResolvedValueOnce(response('outside'));
    const { result, rerender } = renderHook(({ userId }) => useFocusedSourceNote(userId, 'outside', false), { initialProps: { userId: 'A' } });
    rerender({ userId: 'B' });
    await waitFor(() => expect(result.current.state?.note?._id).toBe('outside'));
    await act(async () => { resolveA(response('outside')); });
    expect(result.current.state?.key).toBe('B:outside');
    act(() => result.current.markUnavailable('outside'));
    expect(result.current.state?.status).toBe('missing');
  });

  it('shows missing or retryable read errors', async () => {
    authFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const { result } = renderHook(() => useFocusedSourceNote('A', 'missing', false));
    await waitFor(() => expect(result.current.state?.status).toBe('missing'));
    authFetch.mockRejectedValueOnce(new Error('network'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state?.status).toBe('error'));
    authFetch.mockResolvedValueOnce(response('missing'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
  });

  it('retains the canonical edit and marks successful deletion unavailable', async () => {
    authFetch.mockResolvedValue(response('outside'));
    const { result } = renderHook(() => useFocusedSourceNote('A', 'outside', false));
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    const ownership = result.current.captureMutation('outside');
    act(() => result.current.applyCanonical({ ...note('outside'), revision: 2, content: '新原文' } as never, ownership));
    expect(result.current.state?.note?.revision).toBe(2);
    act(() => result.current.markUnavailable('outside'));
    expect(result.current.state?.status).toBe('missing');
  });

  it('does not revive a deleted source from late PATCH success or conflict snapshots', async () => {
    authFetch.mockResolvedValue(response('outside'));
    const { result } = renderHook(() => useFocusedSourceNote('A', 'outside', false));
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    const ownership = result.current.captureMutation('outside');
    let resolveSave!: (value: ReturnType<typeof note>) => void;
    const lateSave = new Promise<ReturnType<typeof note>>((resolve) => { resolveSave = resolve; });
    const saveResult = lateSave.then((canonical) => result.current.applyCanonical(canonical as never, ownership));
    act(() => result.current.markUnavailable('outside'));
    resolveSave({ ...note('outside'), revision: 2 });
    await act(async () => { await saveResult; });
    act(() => result.current.applyCanonical({ ...note('outside'), revision: 3 } as never, ownership));
    expect(result.current.state?.status).toBe('missing');
    expect(result.current.state?.note).toBeUndefined();
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects old mutation ownership after an ID switch and return', async () => {
    authFetch.mockImplementation((url: string) => Promise.resolve(response(String(url).endsWith('other') ? 'other' : 'outside')));
    const { result, rerender } = renderHook(({ noteId }) => useFocusedSourceNote('A', noteId, false), { initialProps: { noteId: 'outside' } });
    await waitFor(() => expect(result.current.state?.note?._id).toBe('outside'));
    const oldOwnership = result.current.captureMutation('outside');
    rerender({ noteId: 'other' });
    await waitFor(() => expect(result.current.state?.note?._id).toBe('other'));
    rerender({ noteId: 'outside' });
    await waitFor(() => expect(result.current.state?.note?._id).toBe('outside'));
    act(() => result.current.applyCanonical({ ...note('outside'), revision: 9 } as never, oldOwnership));
    expect(result.current.state?.note?.revision).toBe(1);
  });

  it('applies recommendation caches only to the owned source revision', async () => {
    authFetch.mockResolvedValue(response('outside'));
    const { result } = renderHook(() => useFocusedSourceNote('A', 'outside', false));
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    const ownership = result.current.captureMutation('outside');
    act(() => result.current.applyRecommendCache(1, { sourceRevision: 1, byCandidateId: { related: { s2: 0.9 } } }, ownership));
    expect(result.current.state?.note?.recommendCache?.byCandidateId?.related).toBeDefined();
    act(() => result.current.applyCanonical({ ...note('outside'), revision: 2 } as never, ownership));
    act(() => result.current.applyRecommendCache(1, { sourceRevision: 1, byCandidateId: { stale: { s2: 0.9 } } }, ownership));
    expect(result.current.state?.note?.recommendCache?.byCandidateId?.stale).toBeUndefined();
  });
});

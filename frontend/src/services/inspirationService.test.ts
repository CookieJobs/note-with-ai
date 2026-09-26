import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch: mockAuthFetch }));

import { changeInspirationState, getInspirationSettings, getLatestInspiration, getUnviewedInspirationCount, InspirationApiError, listInspirations, requestInspiration, setInspirationEnabled } from './inspirationService';

describe('inspirationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves only stable backend errors', async () => {
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({
      success: false, error: '目前无法进行研究', code: 'SEARCH_PROVIDER_UNAVAILABLE',
      query: 'private query', details: { content: 'private note context' },
    }), { status: 503 }));

    await expect(requestInspiration()).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_UNAVAILABLE', message: '目前无法进行研究', status: 503,
    });
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/inspirations', { method: 'POST' });
  });

  it('drops unknown error codes and response fields', async () => {
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({
      success: false, error: 'failed', code: 'PRIVATE_INTERNAL_CODE', query: 'private query',
    }), { status: 500 }));

    const thrown = requestInspiration();
    await expect(thrown).rejects.toBeInstanceOf(InspirationApiError);
    await expect(thrown).rejects.toMatchObject({ code: undefined, status: 500, message: '暂时无法研究新灵感' });
  });

  it('returns only the latest safe DTO', async () => {
    const item = { id: 'i1', topicLabel: '知识管理', headline: '整理方法', brief: '摘要【1】', whyRelevant: '相关', nextQuestion: '下一步？', sources: [], createdAt: '2026-09-22' };
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { item, internalQuery: 'hidden' } }), { status: 200 }));

    await expect(getLatestInspiration()).resolves.toEqual({ ...item, userState: 'regular', origin: 'manual', viewedAt: null });
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/inspirations/latest');
  });

  it('loads a safe paged history with legacy defaults and a cursor', async () => {
    const item = { id: 'i1', topicLabel: '主题', headline: '研究标题', brief: '摘要', whyRelevant: '关联', nextQuestion: '下一步', sources: [], createdAt: '2026-09-22T00:00:00Z', internalQuery: 'private query' };
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [item], nextCursor: 'next-page' } }), { status: 200 }));
    await expect(listInspirations('recent', null)).resolves.toEqual({ items: [{ ...item, internalQuery: undefined, userState: 'regular', origin: 'manual', viewedAt: null }].map(({ internalQuery, ...safe }) => safe), nextCursor: 'next-page' });
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/inspirations?view=recent');
  });

  it('sends only the requested state operation', async () => {
    const item = { id: 'i1', topicLabel: '主题', headline: '研究标题', brief: '摘要', whyRelevant: '关联', nextQuestion: '下一步', sources: [], createdAt: '2026-09-22T00:00:00Z', userState: 'saved' };
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { item } }), { status: 200 }));
    await expect(changeInspirationState('i1', 'save')).resolves.toMatchObject({ userState: 'saved' });
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/inspirations/i1/user-state', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'save' }),
    });
  });

  it('reads and changes the explicit opt-in setting without calling research', async () => {
    const settings = { enabled: false, consentedAt: null, nextEligibleAt: null, lastAttemptAt: null, lastStatus: null };
    mockAuthFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: settings }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ...settings, enabled: true } }), { status: 200 }));
    await expect(getInspirationSettings()).resolves.toEqual(settings);
    await expect(setInspirationEnabled(true)).resolves.toMatchObject({ enabled: true });
    expect(mockAuthFetch).toHaveBeenNthCalledWith(1, '/api/inspirations/settings');
    expect(mockAuthFetch).toHaveBeenNthCalledWith(2, '/api/inspirations/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
  });

  it('reads only the server-owned count of unviewed scheduled items', async () => {
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { count: 3, privateQuery: 'hidden' } }), { status: 200 }));
    await expect(getUnviewedInspirationCount()).resolves.toBe(3);
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/inspirations/unviewed-count');
  });

  it('uses a safe fallback for malformed JSON', async () => {
    mockAuthFetch.mockResolvedValue(new Response('not-json', { status: 503 }));

    await expect(requestInspiration()).rejects.toMatchObject({
      code: undefined, message: '暂时无法研究新灵感', status: 503,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch: mockAuthFetch }));

import { getLatestInspiration, InspirationApiError, requestInspiration } from './inspirationService';

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

    await expect(getLatestInspiration()).resolves.toEqual(item);
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/inspirations/latest');
  });

  it('uses a safe fallback for malformed JSON', async () => {
    mockAuthFetch.mockResolvedValue(new Response('not-json', { status: 503 }));

    await expect(requestInspiration()).rejects.toMatchObject({
      code: undefined, message: '暂时无法研究新灵感', status: 503,
    });
  });
});

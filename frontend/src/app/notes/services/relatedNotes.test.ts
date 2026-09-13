import { describe, expect, it, vi } from 'vitest';
import { authFetch } from '../../../utils/auth';
import { fetchRelatedNotes } from './relatedNotes';

vi.mock('../../../utils/auth', () => ({ authFetch: vi.fn() }));

const relationship = {
  id: 'candidate-1',
  title: '项目计划',
  contentText: '下一步安排',
  createdAt: '2026-09-12T00:00:00.000Z',
  type: '同一主题',
  reason: '讨论同一个项目',
  scoreBand: 'supported',
};

describe('fetchRelatedNotes', () => {
  it('returns validated relationship summaries from the owner-scoped endpoint', async () => {
    const signal = new AbortController().signal;
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { sourceRevision: 3, relationships: [relationship] },
      }),
    } as Response);

    await expect(fetchRelatedNotes('source-1', signal)).resolves.toEqual([relationship]);
    expect(authFetch).toHaveBeenCalledWith('/api/recommend/notes/source-1', { signal });
  });

  it('rejects malformed summaries and responses that leak numeric diagnostics', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          sourceRevision: 3,
          relationships: [{ ...relationship, s1: 0.9 }],
        },
      }),
    } as Response);

    await expect(fetchRelatedNotes('source-1')).rejects.toThrow('相关笔记响应无效');
  });

  it('rejects non-canonical dates, unnormalized whitespace, and oversized public fields', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          sourceRevision: 3,
          relationships: [{ ...relationship, createdAt: '2026-09-12', title: ` ${'标题'.repeat(200)}` }],
        },
      }),
    } as Response);

    await expect(fetchRelatedNotes('source-1')).rejects.toThrow('相关笔记响应无效');
  });

  it.each([
    ['title', { title: 'a'.repeat(201) }],
    ['content text', { contentText: 'a'.repeat(2001) }],
    ['type', { type: 'a'.repeat(81) }],
    ['reason', { reason: 'a'.repeat(501) }],
    ['noncanonical ISO date', { createdAt: '2026-09-12T00:00:00Z' }],
  ])('rejects an oversized or invalid %s boundary independently', async (_name, override) => {
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { sourceRevision: 3, relationships: [{ ...relationship, ...override }] } }) } as Response);
    await expect(fetchRelatedNotes('source-1')).rejects.toThrow('相关笔记响应无效');
  });

  it('accepts every exact public field limit with a canonical date', async () => {
    const exact = { ...relationship, title: 'a'.repeat(200), contentText: 'b'.repeat(2000), type: 'c'.repeat(80), reason: 'd'.repeat(500) };
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { sourceRevision: 3, relationships: [exact] } }) } as Response);
    await expect(fetchRelatedNotes('source-1')).resolves.toEqual([exact]);
  });

  it('rejects a shape-valid but calendar-invalid canonical timestamp', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { sourceRevision: 3, relationships: [{ ...relationship, createdAt: '2026-02-30T00:00:00.000Z' }] } }),
    } as Response);

    await expect(fetchRelatedNotes('source-1')).rejects.toThrow('相关笔记响应无效');
  });
});

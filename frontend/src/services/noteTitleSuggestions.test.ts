import { describe, expect, it, vi } from 'vitest';
import { suggestNoteTitle } from './noteTitleSuggestions';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch }));

describe('suggestNoteTitle', () => {
  const requestId = '9b62f60a-a361-4297-b1a1-94f0479d22a8';
  const body = { kind: 'plain-text' as const, text: '可命名的正文' };
  const signal = new AbortController().signal;

  it('uses the authenticated endpoint and validates the complete success envelope', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true,
      data: { title: '标题', clientRequestId: requestId, sourceFingerprint: 'a'.repeat(64) } }) });
    await expect(suggestNoteTitle(body, requestId, signal)).resolves.toMatchObject({ title: '标题' });
    expect(authFetch).toHaveBeenCalledWith('/api/notes/title-suggestions', expect.objectContaining({
      method: 'POST', signal, body: JSON.stringify({ body, clientRequestId: requestId }),
    }));
  });

  it.each([
    { title: '跨\n行', clientRequestId: requestId, sourceFingerprint: 'a'.repeat(64) },
    { title: 'x'.repeat(61), clientRequestId: requestId, sourceFingerprint: 'a'.repeat(64) },
    { title: '标题', clientRequestId: 'different', sourceFingerprint: 'a'.repeat(64) },
    { title: '标题', clientRequestId: requestId, sourceFingerprint: 'bad' },
  ])('rejects invalid suggestion payloads', async (data) => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data }) });
    await expect(suggestNoteTitle(body, requestId, signal)).rejects.toThrow('响应无效');
  });

  it.each([
    [422, 'NOTE_TITLE_TEXT_UNAVAILABLE', '手写标题'],
    [413, 'NOTE_TITLE_INPUT_TOO_LONG', '正文太长'],
    [503, 'NOTE_TITLE_PROVIDER_UNAVAILABLE', '手写标题'],
  ])('maps a %i title error envelope to readable guidance', async (status, code, guidance) => {
    authFetch.mockResolvedValue({ ok: false, status, json: async () => ({
      success: false, message: code, code, type: 'VALIDATION_ERROR',
    }) });
    await expect(suggestNoteTitle(body, requestId, signal)).rejects.toThrow(guidance);
  });

  it('includes the retry delay from the rate limit envelope', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({
      success: false, message: 'NOTE_TITLE_RATE_LIMITED', code: 'NOTE_TITLE_RATE_LIMITED',
      details: { retryAfterSeconds: 27 },
    }) });
    await expect(suggestNoteTitle(body, requestId, signal)).rejects.toThrow('27 秒后重试');
  });
});

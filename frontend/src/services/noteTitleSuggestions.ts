import { authFetch } from '../utils/auth';
import type { NoteBodyInput } from '../app/notes/hooks/useNotes';

export type NoteTitleSuggestion = {
  title: string;
  clientRequestId: string;
  sourceFingerprint: string;
};

const titleErrorMessages: Record<string, string> = {
  NOTE_TITLE_INPUT_INVALID: '正文还不能用于生成标题，请检查内容或手写标题。',
  NOTE_TITLE_TEXT_UNAVAILABLE: '图片内容无法用于生成标题，你可以手写标题。',
  NOTE_TITLE_INPUT_TOO_LONG: '正文太长，无法生成标题；你可以手写标题。',
  NOTE_TITLE_PROVIDER_UNAVAILABLE: '暂时无法生成标题，你可以手写标题或稍后重试。',
  NOTE_TITLE_GENERATION_FAILED: '标题生成失败，请稍后重试。',
  NOTE_TITLE_GENERATION_TIMEOUT: '标题生成超时，请稍后重试。',
};

function titleErrorMessage(payload: unknown, status: number): string {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const details = record.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : {};
  const code = typeof record.code === 'string' ? record.code
    : typeof details.code === 'string' ? details.code : record.message;
  if (code === 'NOTE_TITLE_RATE_LIMITED') {
    const retry = details.retryAfterSeconds;
    const seconds = typeof retry === 'number' && Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null;
    return seconds ? `标题生成暂时受限，请 ${seconds} 秒后重试；你仍可手写标题。`
      : '标题生成暂时受限，请稍后重试；你仍可手写标题。';
  }
  if (typeof code === 'string' && titleErrorMessages[code]) return titleErrorMessages[code];
  if (status === 401) return '请重新登录后生成标题；当前草稿仍可继续编辑。';
  return '标题生成失败，请稍后重试。';
}

export async function suggestNoteTitle(body: NoteBodyInput, clientRequestId: string, signal: AbortSignal): Promise<NoteTitleSuggestion> {
  const response = await authFetch('/api/notes/title-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, clientRequestId }),
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(titleErrorMessage(payload, response.status));
  }
  if (!payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true || !('data' in payload)) {
    throw new Error('标题生成响应无效');
  }
  const data = payload.data;
  if (!data || typeof data !== 'object' || !('title' in data) || !('clientRequestId' in data) || !('sourceFingerprint' in data)
    || typeof data.title !== 'string' || typeof data.clientRequestId !== 'string' || typeof data.sourceFingerprint !== 'string'
    || data.clientRequestId !== clientRequestId || !data.title.trim()
    || Array.from(data.title).length > 60 || /[\r\n\u2028\u2029]/u.test(data.title)
    || !/^[a-f0-9]{64}$/u.test(data.sourceFingerprint)) {
    throw new Error('标题生成响应无效');
  }
  return data as NoteTitleSuggestion;
}

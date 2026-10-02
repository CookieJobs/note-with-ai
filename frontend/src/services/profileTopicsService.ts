import { authFetch } from '../utils/auth';

export type TopicScope = 'all' | 'year' | 'sixMonths';

export interface TopicSnapshot {
  noteCount: number;
  indexedAt: string | null;
  topics: Array<{ topic: string; noteCount: number }>;
  label: '旧快照，不计入当前覆盖';
}

export interface UserTopicIndexDto {
  scope: TopicScope;
  timezone: 'Asia/Shanghai';
  rangeStart: string | null;
  rangeEnd: string | null;
  totalNotesInRange: number;
  readyNotesInRange: number;
  pendingNotesInRange: number;
  failedNotesInRange: number;
  lastErrorAt: string | null;
  topics: Array<{ topic: string; noteCount: number }>;
  staleSnapshot: TopicSnapshot | null;
  indexStatus: 'empty' | 'building' | 'ready' | 'partial' | 'failed';
  updatedAt: string | null;
}

export interface TopicRetryResponse {
  acceptedCount: number;
  alreadyRunningCount: number;
  rateLimitedCount: number;
  nextRetryAt: string | null;
}

const REQUEST_TIMEOUT_MS = 12_000;

async function requestData<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) throw new Error('Request aborted');
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  try {
    const request = (async () => {
      const response = await authFetch(path, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error('Request failed');
      const body = await response.json();
      return body.data as T;
    })();
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error('Request timed out'));
        }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

export function getProfileTopics(scope: TopicScope, signal?: AbortSignal): Promise<UserTopicIndexDto> {
  return requestData(`/api/profile/topics?scope=${encodeURIComponent(scope)}`, { signal });
}

export function retryFailedProfileTopics(scope: TopicScope): Promise<TopicRetryResponse> {
  return requestData('/api/profile/topics/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  });
}

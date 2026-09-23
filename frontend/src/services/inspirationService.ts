import { authFetch } from '../utils/auth';

export type InspirationErrorCode =
  | 'SEARCH_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'SEARCH_PROVIDER_FAILED'
  | 'NO_RESULT'
  | 'INSPIRATION_SYNTHESIS_FAILED'
  | 'INSPIRATION_IN_PROGRESS';

export type InspirationSource = {
  sourceId: string;
  canonicalUrl: string;
  title: string;
  publisher: string;
  snippet: string;
  retrievedAt: string;
};

export type InspirationItem = {
  id: string;
  topicLabel: string;
  headline: string;
  brief: string;
  whyRelevant: string;
  nextQuestion: string;
  sources: InspirationSource[];
  createdAt: string;
};

export type RequestInspirationResult =
  | { status: 'created'; item: InspirationItem }
  | { status: 'no_result' };

const knownErrorCodes = new Set<InspirationErrorCode>([
  'SEARCH_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_UNAVAILABLE',
  'SEARCH_PROVIDER_FAILED',
  'NO_RESULT',
  'INSPIRATION_SYNTHESIS_FAILED',
  'INSPIRATION_IN_PROGRESS',
]);

export class InspirationApiError extends Error {
  constructor(
    public readonly code: InspirationErrorCode | undefined,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'InspirationApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toSource(value: unknown): InspirationSource | null {
  if (!isRecord(value)) return null;
  const source = {
    sourceId: safeString(value.sourceId),
    canonicalUrl: safeString(value.canonicalUrl),
    title: safeString(value.title),
    publisher: safeString(value.publisher),
    snippet: safeString(value.snippet),
    retrievedAt: safeString(value.retrievedAt),
  };
  return source.sourceId && source.canonicalUrl && source.title ? source : null;
}

function toItem(value: unknown): InspirationItem | null {
  if (!isRecord(value)) return null;
  const sources = Array.isArray(value.sources)
    ? value.sources.map(toSource).filter((source): source is InspirationSource => source !== null)
    : [];
  const item = {
    id: safeString(value.id),
    topicLabel: safeString(value.topicLabel),
    headline: safeString(value.headline),
    brief: safeString(value.brief),
    whyRelevant: safeString(value.whyRelevant),
    nextQuestion: safeString(value.nextQuestion),
    sources,
    createdAt: safeString(value.createdAt),
  };
  return item.id && item.headline ? item : null;
}

async function readEnvelope(response: Response, fallback: string): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    const code = typeof record.code === 'string' && knownErrorCodes.has(record.code as InspirationErrorCode)
      ? record.code as InspirationErrorCode
      : undefined;
    const suppliedMessage = typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string' ? record.error : '';
    const message = code && suppliedMessage.length > 0 && suppliedMessage.length <= 160
      ? suppliedMessage
      : fallback;
    throw new InspirationApiError(code, response.status, message);
  }

  if (!isRecord(payload) || payload.success !== true || !('data' in payload)) {
    throw new InspirationApiError(undefined, response.status, fallback);
  }
  return payload.data;
}

export async function requestInspiration(): Promise<RequestInspirationResult> {
  const data = await readEnvelope(await authFetch('/api/inspirations', { method: 'POST' }), '暂时无法研究新灵感');
  if (isRecord(data) && data.status === 'no_result') return { status: 'no_result' };
  if (isRecord(data) && data.status === 'created') {
    const item = toItem(data.item);
    if (item) return { status: 'created', item };
  }
  throw new InspirationApiError(undefined, 502, '暂时无法研究新灵感');
}

export async function getLatestInspiration(): Promise<InspirationItem | null> {
  const data = await readEnvelope(await authFetch('/api/inspirations/latest'), '暂时无法加载灵感');
  if (!isRecord(data) || data.item === null) return null;
  const item = toItem(data.item);
  if (item) return item;
  throw new InspirationApiError(undefined, 502, '暂时无法加载灵感');
}

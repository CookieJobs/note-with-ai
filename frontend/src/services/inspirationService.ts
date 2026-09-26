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
  userState: 'regular' | 'saved' | 'dismissed';
  origin: 'manual' | 'scheduled';
  viewedAt: string | null;
};

export type InspirationView = 'recent' | 'saved' | 'dismissed';
export type InspirationStateOperation = 'save' | 'unsave' | 'dismiss' | 'restore';
export type InspirationSettings = {
  enabled: boolean;
  consentedAt: string | null;
  nextEligibleAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: string | null;
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
  const userState: InspirationItem['userState'] = value.userState === 'saved' || value.userState === 'dismissed'
    ? value.userState
    : 'regular';
  const origin: InspirationItem['origin'] = value.origin === 'scheduled' ? 'scheduled' : 'manual';
  const item = {
    id: safeString(value.id),
    topicLabel: safeString(value.topicLabel),
    headline: safeString(value.headline),
    brief: safeString(value.brief),
    whyRelevant: safeString(value.whyRelevant),
    nextQuestion: safeString(value.nextQuestion),
    sources,
    createdAt: safeString(value.createdAt),
    userState,
    origin,
    viewedAt: typeof value.viewedAt === 'string' ? value.viewedAt : null,
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

function itemFromEnvelope(data: unknown, fallback: string): InspirationItem {
  const item = isRecord(data) ? toItem(data.item) : null;
  if (!item) throw new InspirationApiError(undefined, 502, fallback);
  return item;
}

export async function listInspirations(view: InspirationView, cursor: string | null = null): Promise<{ items: InspirationItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ view });
  if (cursor) params.set('cursor', cursor);
  const data = await readEnvelope(await authFetch(`/api/inspirations?${params.toString()}`), '暂时无法加载灵感历史');
  if (!isRecord(data) || !Array.isArray(data.items)) throw new InspirationApiError(undefined, 502, '暂时无法加载灵感历史');
  const items = data.items.map(toItem);
  if (items.some((item) => item === null) || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) {
    throw new InspirationApiError(undefined, 502, '暂时无法加载灵感历史');
  }
  return { items: items as InspirationItem[], nextCursor: data.nextCursor as string | null };
}

export async function getInspiration(id: string): Promise<InspirationItem> {
  const data = await readEnvelope(await authFetch(`/api/inspirations/${encodeURIComponent(id)}`), '暂时无法加载灵感');
  return itemFromEnvelope(data, '暂时无法加载灵感');
}

export async function changeInspirationState(id: string, operation: InspirationStateOperation): Promise<InspirationItem> {
  const data = await readEnvelope(await authFetch(`/api/inspirations/${encodeURIComponent(id)}/user-state`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation }),
  }), '暂时无法更新灵感');
  return itemFromEnvelope(data, '暂时无法更新灵感');
}

export async function markInspirationViewed(id: string): Promise<InspirationItem> {
  const data = await readEnvelope(await authFetch(`/api/inspirations/${encodeURIComponent(id)}/viewed`, { method: 'POST' }), '暂时无法标记灵感');
  return itemFromEnvelope(data, '暂时无法标记灵感');
}

function settingsFromEnvelope(data: unknown): InspirationSettings {
  if (!isRecord(data) || typeof data.enabled !== 'boolean') throw new InspirationApiError(undefined, 502, '暂时无法加载灵感设置');
  const nullable = (value: unknown) => typeof value === 'string' ? value : null;
  return {
    enabled: data.enabled,
    consentedAt: nullable(data.consentedAt),
    nextEligibleAt: nullable(data.nextEligibleAt),
    lastAttemptAt: nullable(data.lastAttemptAt),
    lastStatus: nullable(data.lastStatus),
  };
}

export async function getInspirationSettings(): Promise<InspirationSettings> {
  const data = await readEnvelope(await authFetch('/api/inspirations/settings'), '暂时无法加载灵感设置');
  return settingsFromEnvelope(data);
}

export async function setInspirationEnabled(enabled: boolean): Promise<InspirationSettings> {
  const data = await readEnvelope(await authFetch('/api/inspirations/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
  }), '暂时无法更新灵感设置');
  return settingsFromEnvelope(data);
}

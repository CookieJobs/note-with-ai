import { AppError, ErrorType } from '../utils/errorHandler';

export type InspirationErrorCode =
  | 'SEARCH_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'SEARCH_PROVIDER_FAILED'
  | 'NO_RESULT'
  | 'INSPIRATION_SYNTHESIS_FAILED'
  | 'INSPIRATION_IN_PROGRESS';

export type LimitedNoteContext = {
  noteId: string;
  revision: number;
  title: string;
  keywords: string[];
  summary: string;
};

export type ResearchPlan = { query: string; topicLabel: string };

export type ResearchSource = {
  sourceId: string;
  canonicalUrl: string;
  title: string;
  publisher: string;
  snippet: string;
  retrievedAt: string;
};

export type ResearchDraft = {
  headline: string;
  brief: string;
  whyRelevant: string;
  nextQuestion: string;
  sourceIds: string[];
};

export type InspirationDto = {
  id: string;
  topicLabel: string;
  headline: string;
  brief: string;
  whyRelevant: string;
  nextQuestion: string;
  sources: ResearchSource[];
  createdAt: string;
  userState: 'regular' | 'saved' | 'dismissed';
  origin: 'manual' | 'scheduled';
  viewedAt: string | null;
};

function stringValue(value: unknown): string {
  if (value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value || '');
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function toInspirationDto(item: Record<string, unknown>): InspirationDto {
  const sources = Array.isArray(item.sources) ? item.sources.map((entry) => {
    const source = entry as Record<string, unknown>;
    return {
      sourceId: String(source.sourceId || ''),
      canonicalUrl: String(source.canonicalUrl || ''),
      title: String(source.title || ''),
      publisher: String(source.publisher || ''),
      snippet: String(source.snippet || ''),
      retrievedAt: isoDate(source.retrievedAt),
    };
  }) : [];
  return {
    id: stringValue(item._id),
    topicLabel: String(item.topicLabel || ''),
    headline: String(item.headline || ''),
    brief: String(item.brief || ''),
    whyRelevant: String(item.whyRelevant || ''),
    nextQuestion: String(item.nextQuestion || ''),
    sources,
    createdAt: isoDate(item.createdAt),
    userState: item.userState === 'saved' || item.userState === 'dismissed' ? item.userState : 'regular',
    origin: item.origin === 'scheduled' ? 'scheduled' : 'manual',
    viewedAt: item.viewedAt ? isoDate(item.viewedAt) : null,
  };
}

export function inspirationError(code: InspirationErrorCode, statusCode: number): AppError {
  const messages: Record<InspirationErrorCode, string> = {
    SEARCH_PROVIDER_UNAVAILABLE: '目前无法进行网络检索',
    AI_PROVIDER_UNAVAILABLE: '目前无法整理灵感',
    SEARCH_PROVIDER_FAILED: '网络检索暂时不可用',
    NO_RESULT: '这次没有找到新灵感',
    INSPIRATION_SYNTHESIS_FAILED: '暂时无法整理出可靠的灵感，请重试',
    INSPIRATION_IN_PROGRESS: '已有一条灵感研究正在进行',
  };
  return new AppError(messages[code], statusCode === 409 || statusCode === 400
    ? ErrorType.VALIDATION
    : ErrorType.EXTERNAL_API, statusCode, true, { code });
}

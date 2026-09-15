import { authFetch } from '../../../utils/auth';

export type RelatedNoteSummary = {
  id: string;
  title: string;
  contentText: string;
  createdAt: string;
  type: string;
  reason: string;
  scoreBand: 'possible' | 'supported';
};

export type RelatedNotesResponse = {
  sourceRevision: number;
  relationships: RelatedNoteSummary[];
};

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_TEXT_LENGTH = 2000;
const MAX_TYPE_LENGTH = 80;
const MAX_REASON_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNormalizedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && value === value.replace(/\s+/g, ' ').trim();
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isRelatedNoteSummary(value: unknown): value is RelatedNoteSummary {
  return isRecord(value)
    && !('s1' in value)
    && !('s2' in value)
    && !('score' in value)
    && typeof value.id === 'string'
    && isNormalizedText(value.title, MAX_TITLE_LENGTH)
    && isNormalizedText(value.contentText, MAX_CONTENT_TEXT_LENGTH)
    && isCanonicalIsoDate(value.createdAt)
    && isNormalizedText(value.type, MAX_TYPE_LENGTH)
    && isNormalizedText(value.reason, MAX_REASON_LENGTH)
    && (value.scoreBand === 'possible' || value.scoreBand === 'supported');
}

export async function fetchRelatedNotes(noteId: string, signal?: AbortSignal): Promise<RelatedNotesResponse> {
  const response = await authFetch(`/api/recommend/notes/${encodeURIComponent(noteId)}`, { signal });
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)
    || !Number.isInteger(payload.data.sourceRevision) || Number(payload.data.sourceRevision) <= 0
    || !Array.isArray(payload.data.relationships) || !payload.data.relationships.every(isRelatedNoteSummary)) {
    throw new Error('相关笔记响应无效');
  }

  return {
    sourceRevision: Number(payload.data.sourceRevision),
    relationships: payload.data.relationships,
  };
}

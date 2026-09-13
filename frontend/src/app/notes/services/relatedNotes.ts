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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRelatedNoteSummary(value: unknown): value is RelatedNoteSummary {
  return isRecord(value)
    && !('s1' in value)
    && !('s2' in value)
    && !('score' in value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.contentText === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.type === 'string'
    && typeof value.reason === 'string'
    && (value.scoreBand === 'possible' || value.scoreBand === 'supported');
}

export async function fetchRelatedNotes(noteId: string, signal?: AbortSignal): Promise<RelatedNoteSummary[]> {
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

  return payload.data.relationships;
}

export type RelatedNoteSummary = {
  noteId: string;
  title: string;
  contentText: string;
  type: string;
  reason: string;
  revision: number;
};

type RelatedNotesResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type RelatedNotesFetcher = (input: string) => Promise<RelatedNotesResponse>;

function asSummary(value: unknown): RelatedNoteSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.noteId !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.contentText !== 'string' ||
    typeof item.type !== 'string' ||
    typeof item.reason !== 'string' ||
    !Number.isInteger(item.revision) ||
    Number(item.revision) < 1
  ) return null;
  return {
    noteId: item.noteId,
    title: item.title,
    contentText: item.contentText,
    type: item.type,
    reason: item.reason,
    revision: Number(item.revision),
  };
}

export async function fetchRelatedNoteSummaries(noteId: string, fetcher: RelatedNotesFetcher): Promise<RelatedNoteSummary[]> {
  const response = await fetcher(`/api/recommend/notes/${encodeURIComponent(noteId)}`);
  if (!response.ok) throw new Error('关联笔记读取失败');
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('关联笔记读取响应无效');
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('关联笔记读取响应无效');
  const notes = (data as Record<string, unknown>).notes;
  if (!Array.isArray(notes)) throw new Error('关联笔记读取响应无效');
  const summaries = notes.map(asSummary);
  if (summaries.some((summary) => summary === null)) throw new Error('关联笔记读取响应无效');
  return summaries as RelatedNoteSummary[];
}

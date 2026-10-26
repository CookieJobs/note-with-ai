import type { IChat, IRelatedNote } from '../types';
import { noteReferenceDisplay } from './noteReference';

const GENERIC_TITLES = new Set(['', '新对话', '新会话']);
const IMAGE_ONLY_LINE =
  /^(?:\[图片\]|\[image\]|!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>)$/iu;

function relatedNotes(session: IChat): IRelatedNote[] {
  return [
    ...(session.relatedNotes ?? []),
    ...session.messages.flatMap((message) => message.relatedNotes ?? []),
  ];
}

function sourceLabel(note: IRelatedNote): string | null {
  const text = note.excerpt?.trim() || note.content || '';
  const readable = text
    .split(/\r?\n/u)
    .some((line) => line.trim() && !IMAGE_ONLY_LINE.test(line.trim()));
  return note.title?.trim() || readable
    ? noteReferenceDisplay(note).label
    : null;
}

function compactLabel(value: string): string {
  const points = Array.from(value.replace(/\s+/gu, ' ').trim());
  return points.length > 48
    ? `${points.slice(0, 48).join('')}…`
    : points.join('');
}

/** Derive a useful name locally without renaming the stored conversation. */
export function getChatHistoryLabel(session: IChat): string {
  const title = session.title?.trim() || '';
  if (!GENERIC_TITLES.has(title)) return title;
  const sources = relatedNotes(session);
  const source =
    sources.find(
      (note) => note.matchType === 'care_source' && sourceLabel(note),
    ) ?? sources.find((note) => sourceLabel(note));
  if (source) return compactLabel(sourceLabel(source)!);
  const message =
    session.messages.find(
      (entry) => entry.role === 'user' && entry.content.trim(),
    ) ?? session.messages.find((entry) => entry.content.trim());
  return message ? compactLabel(message.content) : '新对话';
}

/** Search only loaded session data, including source snapshots inside messages. */
export function matchesChatHistoryQuery(
  session: IChat,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const fields = [
    session.title,
    getChatHistoryLabel(session),
    ...session.messages.map((message) => message.content),
    ...relatedNotes(session).flatMap((note) => [
      note.title,
      note.excerpt,
      note.content,
    ]),
  ];
  return fields.some((field) => field?.toLocaleLowerCase().includes(needle));
}

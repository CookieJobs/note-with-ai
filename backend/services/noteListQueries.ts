/* Read-only note-list query validation. No writes, enrichment or model calls. */
import { ErrorHandler } from '../utils/errorHandler';

export function parseSearchQuery(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw ErrorHandler.createValidationError('搜索关键词必须是文字');
  const query = value.trim();
  if (Array.from(query).length > 100) throw ErrorHandler.createValidationError('搜索关键词不能超过 100 个字符');
  return query;
}

export function buildNoteSearchFilter(query: string): Record<string, unknown> {
  if (!query) return {};
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $or: [
    { title: { $regex: escaped, $options: 'i' } },
    { $expr: { $regexMatch: {
      input: { $cond: [
        { $ne: [{ $trim: { input: { $ifNull: ['$contentText', ''] } } }, ''] },
        '$contentText', { $ifNull: ['$content', ''] },
      ] }, regex: escaped, options: 'i',
    } } },
  ] };
}

export function calendarMonthRange(value: unknown): { start: Date; end: Date } {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) {
    throw ErrorHandler.createValidationError('月份必须为 YYYY-MM 格式');
  }
  const [year, month] = value.split('-').map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1) - 8 * 3600_000), end: new Date(Date.UTC(year, month, 1) - 8 * 3600_000) };
}

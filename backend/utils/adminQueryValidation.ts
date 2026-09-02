import { ErrorHandler } from './errorHandler';

export function validateAdminDateRange(from?: unknown, to?: unknown): void {
  if (from === undefined && to === undefined) return;
  if (typeof from !== 'string' || typeof to !== 'string') throw ErrorHandler.createValidationError('日期范围必须同时提供 from 和 to');
  const start = Date.parse(from); const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 90 * 86400000) throw ErrorHandler.createValidationError('日期范围无效，最多支持 90 天');
}

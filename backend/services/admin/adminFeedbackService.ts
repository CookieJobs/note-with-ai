import UserFeedback, { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '../../models/UserFeedback';
import { ProductEventService } from '../productEventService';
import { ErrorHandler } from '../../utils/errorHandler';
import { AdminRole } from '../../models/AdminAccount';

export function toPublicFeedback(row: any): Record<string, unknown> { return { id: String(row._id), status: row.status, category: row.category, content: row.content, createdAt: row.createdAt }; }
export function toAdminFeedback(row: any): Record<string, unknown> { return { ...toPublicFeedback(row), userId: String(row.userId), contact: row.contact ?? null, appVersion: row.appVersion ?? null, internalNote: row.internalNote ?? '', assignedTo: row.assignedTo ? String(row.assignedTo) : null, resolvedAt: row.resolvedAt ?? null, updatedAt: row.updatedAt ?? null }; }

export async function submitFeedback(input: { userId: string; content: string; category: typeof FEEDBACK_CATEGORIES[number]; contact?: string; appVersion?: string }) {
  const since = new Date(Date.now() - 3600000);
  if (await UserFeedback.countDocuments({ userId: input.userId, createdAt: { $gte: since } }) >= 5) throw ErrorHandler.createValidationError('提交反馈过于频繁，请稍后再试');
  const feedback = await UserFeedback.create(input);
  ProductEventService.trackProductEventBestEffort({ name: 'feedback_submitted', userId: input.userId, source: 'server', properties: {} });
  return { id: String(feedback._id) };
}

export async function listFeedback(input: { status?: typeof FEEDBACK_STATUSES[number]; category?: typeof FEEDBACK_CATEGORIES[number]; userId?: string; assignedToSelf?: boolean; adminId?: string; assignedTo?: string; page?: number; limit?: number; from?: string; to?: string }) {
  const page = Math.max(1, input.page ?? 1); const limit = Math.min(100, Math.max(1, input.limit ?? 20)); if (input.limit && input.limit > 100) throw ErrorHandler.createValidationError('limit 不能超过 100');
  const filter: any = {}; if (input.status) filter.status = input.status; if (input.category) filter.category = input.category; if (input.userId) filter.userId = input.userId; if (input.assignedTo) filter.assignedTo = input.assignedTo; if (input.assignedToSelf && input.adminId) filter.assignedTo = input.adminId;
  if (input.from || input.to) filter.createdAt = { ...(input.from ? { $gte: new Date(input.from) } : {}), ...(input.to ? { $lt: new Date(input.to) } : {}) };
  const [rows, total] = await Promise.all([UserFeedback.find(filter).select('+internalNote').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), UserFeedback.countDocuments(filter)]);
  return { items: rows.map(toAdminFeedback), page, limit, total, hasNext: page * limit < total };
}

export async function updateFeedback(id: string, input: { status?: typeof FEEDBACK_STATUSES[number]; internalNote?: string; assignedTo?: string | null }, role: AdminRole) {
  if (role === 'viewer') throw ErrorHandler.createAuthorizationError('无权限访问');
  if (!Object.keys(input).length) throw ErrorHandler.createValidationError('至少修改一个字段');
  const set: any = { ...input }; if (input.status === 'resolved' || input.status === 'closed') set.resolvedAt = new Date(); else if (input.status) set.resolvedAt = null;
  const row = await UserFeedback.findByIdAndUpdate(id, { $set: set }, { new: true }).select('+internalNote').lean();
  if (!row) throw ErrorHandler.createNotFoundError('反馈不存在');
  return toAdminFeedback(row);
}

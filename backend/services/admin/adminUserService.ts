import mongoose from 'mongoose';
import User from '../../models/User';
import { Note } from '../../models/Note';
import Chat from '../../models/Chat';
import ProductEvent from '../../models/ProductEvent';
import AiUsageEvent from '../../models/AiUsageEvent';
import { AdminAuditLog } from '../../models/AdminAuditLog';
import { AdminRole } from '../../models/AdminAccount';
import { ErrorHandler } from '../../utils/errorHandler';

export type AdminUserRow = {
  _id: unknown; username?: string; email: string; isActive: boolean; isVerified: boolean;
  createdAt: Date; lastActiveAt?: Date | null; noteCount?: number; chatCount?: number;
  aiCalls30d?: number; aiKnownTokens30d?: number;
};

export function maskEmail(email: string): string {
  const [local, domain = ''] = email.split('@');
  if (!local) return '***';
  const maskedLocal = local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
  return domain ? `${maskedLocal}@${domain}` : maskedLocal;
}

export function toAdminUserView(row: AdminUserRow, role: AdminRole, includeEmail = false): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: String(row._id), username: row.username ?? '', maskedEmail: maskEmail(row.email),
    isActive: Boolean(row.isActive), isVerified: Boolean(row.isVerified), createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt ?? null, noteCount: Number(row.noteCount ?? 0), chatCount: Number(row.chatCount ?? 0),
    aiCalls30d: Number(row.aiCalls30d ?? 0), aiKnownTokens30d: Number(row.aiKnownTokens30d ?? 0),
  };
  if (includeEmail && role !== 'viewer') view.email = row.email;
  return view;
}

const SAFE_AUDIT_KEYS = new Set(['reason', 'outcome', 'permission', 'status', 'previousStatus', 'nextStatus', 'changedFields', 'sourceRevision', 'idempotent', 'count', 'retryStatus']);
export function toAdminAuditView(row: any): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const raw = row.metadata?.command || row.metadata?.result ? { ...(row.metadata?.command ?? {}), ...(row.metadata?.result ?? {}) } : (row.metadata ?? {});
  for (const [key, value] of Object.entries(raw)) if (SAFE_AUDIT_KEYS.has(key) && (typeof value !== 'string' || value.length <= 256)) metadata[key] = value;
  const actor = row.actorId && typeof row.actorId === 'object' ? { id: String(row.actorId._id ?? row.actorId.id ?? ''), displayName: row.actorId.displayName ?? '' } : { id: row.actorId ? String(row.actorId) : null, displayName: '' };
  return { id: String(row._id), requestId: row.requestId, action: row.action, status: row.status, targetType: row.targetType ?? null, targetId: row.targetId ?? null, actor, metadata, errorCode: row.errorCode ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function validId(id: string): boolean { return mongoose.Types.ObjectId.isValid(id); }
function dateFilter(from?: string, to?: string): Record<string, Date> | undefined {
  if (!from && !to) return undefined;
  const result: Record<string, Date> = {};
  if (from) result.$gte = new Date(from);
  if (to) result.$lt = new Date(to);
  return result;
}

async function enrich(row: any): Promise<AdminUserRow> {
  const id = row._id;
  const since = new Date(Date.now() - 30 * 86400000);
  const [noteCount, chatCount, ai] = await Promise.all([
    Note.countDocuments({ userId: id }), Chat.countDocuments({ userId: id }),
    AiUsageEvent.aggregate([{ $match: { userId: id, startedAt: { $gte: since } } }, { $group: { _id: null, calls: { $sum: 1 }, tokens: { $sum: { $ifNull: ['$totalTokens', 0] } } } }]),
  ]);
  return { ...row, noteCount, chatCount, aiCalls30d: ai[0]?.calls ?? 0, aiKnownTokens30d: ai[0]?.tokens ?? 0 };
}

export async function listUsers(input: { query?: string; status?: 'active' | 'disabled'; from?: string; to?: string; page?: number; limit?: number; role: AdminRole }) {
  const page = Math.max(1, input.page ?? 1); const limit = Math.min(100, Math.max(1, input.limit ?? 20));
  if (limit > 100) throw ErrorHandler.createValidationError('limit 不能超过 100');
  const filter: any = {};
  if (input.status) filter.isActive = input.status === 'active';
  const dates = dateFilter(input.from, input.to); if (dates) filter.createdAt = dates;
  const query = input.query?.trim();
  if (query) {
    if (validId(query)) filter.$or = [{ _id: query }, { email: query.toLowerCase() }];
    else filter.$or = [{ email: query.toLowerCase() }, { username: { $regex: `^${query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`, $options: 'i' } }];
  }
  const [rows, total] = await Promise.all([
    User.find(filter).select('username email isActive isVerified createdAt lastActiveAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  const enriched = await Promise.all(rows.map((row) => enrich(row)));
  return { items: enriched.map((row) => toAdminUserView(row, input.role, false)), pagination: { page, limit, total, hasNext: page * limit < total } };
}

export async function getUser(id: string, role: AdminRole) {
  if (!validId(id)) throw ErrorHandler.createNotFoundError('用户不存在');
  const row = await User.findById(id).select('username email isActive isVerified createdAt lastActiveAt').lean();
  if (!row) throw ErrorHandler.createNotFoundError('用户不存在');
  return toAdminUserView(await enrich(row), role, true);
}

export async function setUserActive(id: string, isActive: boolean) {
  if (!validId(id)) throw ErrorHandler.createNotFoundError('用户不存在');
  const current: any = await User.findById(id).select('isActive').lean();
  if (!current) throw ErrorHandler.createNotFoundError('用户不存在');
  if (Boolean(current.isActive) === isActive) return { id, isActive, idempotent: true };
  const updated: any = await User.findOneAndUpdate({ _id: id }, { $set: { isActive } }, { new: true }).select('isActive').lean();
  if (!updated) throw ErrorHandler.createNotFoundError('用户不存在');
  return { id, isActive: Boolean(updated.isActive), idempotent: false };
}

export async function listAudits(input: { actorId?: string; action?: string; status?: 'pending' | 'succeeded' | 'failed'; from?: string; to?: string; page?: number; limit?: number }) {
  const page = Math.max(1, input.page ?? 1); const limit = Math.min(100, Math.max(1, input.limit ?? 20));
  if (limit > 100) throw ErrorHandler.createValidationError('limit 不能超过 100');
  const filter: any = {}; if (input.actorId) filter.actorId = input.actorId; if (input.action) filter.action = input.action; if (input.status) filter.status = input.status;
  const dates = dateFilter(input.from, input.to); if (dates) filter.createdAt = dates;
  const [rows, total] = await Promise.all([
    AdminAuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('actorId', 'displayName').lean(),
    AdminAuditLog.countDocuments(filter),
  ]);
  return { items: rows.map(toAdminAuditView), pagination: { page, limit, total, hasNext: page * limit < total } };
}

import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AdminAccount, AdminRole } from '../models/AdminAccount';
import { verifyAdminToken } from '../utils/adminJwt';
import { recordAdminSecurityAudit } from '../services/admin/adminAuditService';
import { ErrorHandler } from '../utils/errorHandler';

export type AdminPermission = 'overview:read' | 'users:read' | 'users:status' | 'ai:read' | 'ai:retry' | 'feedback:read' | 'feedback:write' | 'system:read' | 'audit:read' | 'admins:manage';
const all: AdminPermission[] = ['overview:read', 'users:read', 'users:status', 'ai:read', 'ai:retry', 'feedback:read', 'feedback:write', 'system:read', 'audit:read', 'admins:manage'];
const permissions: Record<AdminRole, AdminPermission[]> = { owner: all, operator: all.filter(p => p !== 'admins:manage'), support: ['overview:read', 'users:read', 'ai:read', 'feedback:read', 'feedback:write', 'system:read'], viewer: ['overview:read', 'users:read', 'ai:read', 'feedback:read', 'system:read'] };
export function hasAdminPermission(role: AdminRole, permission: AdminPermission): boolean { return permissions[role].includes(permission); }

declare global { namespace Express { interface Request { admin?: { id: string; email: string; displayName: string; role: AdminRole }; requestId: string; } } }

export function adminNoStore(req: Request, res: Response, next: NextFunction): void { req.requestId = crypto.randomUUID(); res.setHeader('X-Request-Id', req.requestId); res.setHeader('Cache-Control', 'no-store'); next(); }
function deny(next: NextFunction, status: number): void { next(status === 401 ? ErrorHandler.createAuthenticationError('管理员会话无效') : ErrorHandler.createAuthorizationError('无权限访问')); }
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.nwai_admin_session;
    if (typeof token !== 'string') return deny(next, 401);
    const payload = verifyAdminToken(token);
    const account = await AdminAccount.findById(payload.adminId).lean() as { _id: { toString(): string }; email: string; displayName: string; role: AdminRole; isActive: boolean; tokenVersion: number } | null;
    if (!account || !account.isActive || account.tokenVersion !== payload.tokenVersion || account.role !== payload.role) return deny(next, 401);
    req.admin = { id: account._id.toString(), email: account.email, displayName: account.displayName, role: account.role };
    next();
  } catch { deny(next, 401); }
}
export function requireAdminPermission(permission: AdminPermission) { return async (req: Request, _res: Response, next: NextFunction): Promise<void> => { if (!req.admin || !hasAdminPermission(req.admin.role, permission)) { if (req.admin) await recordAdminSecurityAudit({ actorId: req.admin.id, requestId: req.requestId, action: 'admin.permission_denied', status: 'failed', metadata: { permission, outcome: 'denied' } }); return deny(next, 403); } next(); }; }
export function requireAdminMutationOrigin(req: Request, _res: Response, next: NextFunction): void { const origin = req.get('origin'); const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(',').map(v => v.trim()); if (!origin || !allowed.includes(origin)) return deny(next, 403); next(); }

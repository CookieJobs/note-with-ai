import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AdminAccount, AdminRole } from '../models/AdminAccount';
import { verifyAdminToken } from '../utils/adminJwt';
import { recordAdminSecurityAudit } from '../services/admin/adminAuditService';

export type AdminPermission = 'overview:read' | 'users:read' | 'users:status' | 'ai:read' | 'ai:retry' | 'feedback:read' | 'feedback:write' | 'system:read' | 'audit:read' | 'admins:manage';
const all: AdminPermission[] = ['overview:read', 'users:read', 'users:status', 'ai:read', 'ai:retry', 'feedback:read', 'feedback:write', 'system:read', 'audit:read', 'admins:manage'];
const permissions: Record<AdminRole, AdminPermission[]> = { owner: all, operator: all.filter(p => p !== 'admins:manage'), support: ['overview:read', 'users:read', 'ai:read', 'feedback:read', 'feedback:write', 'system:read'], viewer: ['overview:read', 'users:read', 'ai:read', 'feedback:read', 'system:read'] };
export function hasAdminPermission(role: AdminRole, permission: AdminPermission): boolean { return permissions[role].includes(permission); }

declare global { namespace Express { interface Request { admin?: { id: string; email: string; displayName: string; role: AdminRole }; requestId: string; } } }

export function adminNoStore(req: Request, res: Response, next: NextFunction): void { req.requestId = req.headers['x-request-id'] && typeof req.headers['x-request-id'] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.headers['x-request-id']) ? req.headers['x-request-id'] : crypto.randomUUID(); res.setHeader('Cache-Control', 'no-store'); next(); }
function deny(res: Response, status: number): void { res.status(status).json({ error: status === 401 ? '管理员会话无效' : '无权限访问' }); }
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.nwai_admin_session;
    if (typeof token !== 'string') return deny(res, 401);
    const payload = verifyAdminToken(token);
    const account = await AdminAccount.findById(payload.adminId).lean() as { _id: { toString(): string }; email: string; displayName: string; role: AdminRole; isActive: boolean; tokenVersion: number } | null;
    if (!account || !account.isActive || account.tokenVersion !== payload.tokenVersion || account.role !== payload.role) return deny(res, 401);
    req.admin = { id: account._id.toString(), email: account.email, displayName: account.displayName, role: account.role };
    next();
  } catch { deny(res, 401); }
}
export function requireAdminPermission(permission: AdminPermission) { return async (req: Request, res: Response, next: NextFunction): Promise<void> => { if (!req.admin || !hasAdminPermission(req.admin.role, permission)) { if (req.admin) await recordAdminSecurityAudit({ actorId: req.admin.id, requestId: req.requestId, action: 'admin.permission_denied', status: 'failed', metadata: { permission, outcome: 'denied' } }); return deny(res, 403); } next(); }; }
export function requireAdminMutationOrigin(req: Request, res: Response, next: NextFunction): void { const origin = req.get('origin'); const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(',').map(v => v.trim()); if (!origin || !allowed.includes(origin)) return deny(res, 403); next(); }

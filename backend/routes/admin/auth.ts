import express from 'express';
import { authenticateAdmin } from '../../services/admin/adminAuthService';
import { requireAdmin, requireAdminMutationOrigin } from '../../middleware/adminAuth';
import { adminLoginSchema } from '../../schemas/adminSchemas';
import { validate } from '../../middleware/validate';
import { asyncHandler, ResponseHandler } from '../../utils/errorHandler';

const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, path: '/api/admin', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 };
const clientIp = (req: express.Request) => req.ip || req.socket.remoteAddress || 'unknown';
export function createAdminAuthRouter(deps: { authenticate?: typeof authenticateAdmin } = {}) {
const router = express.Router();
const authenticate = deps.authenticate ?? authenticateAdmin;
router.post('/login', requireAdminMutationOrigin, validate(adminLoginSchema), asyncHandler(async (req, res) => { const result = await authenticate({ ...req.body, ip: clientIp(req), requestId: req.requestId }); res.cookie('nwai_admin_session', result.token, cookieOptions); ResponseHandler.success(res, { admin: result.admin }, '登录成功'); }));
router.post('/logout', requireAdminMutationOrigin, (_req, res) => { res.clearCookie('nwai_admin_session', { ...cookieOptions, maxAge: undefined }); ResponseHandler.success(res, undefined, '已登出'); });
router.get('/me', requireAdmin, (req, res) => { ResponseHandler.success(res, { admin: req.admin }); });
return router;
}
export default createAdminAuthRouter();

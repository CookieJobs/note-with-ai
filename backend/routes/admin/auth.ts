import express from 'express';
import { authenticateAdmin, ADMIN_LOGIN_FAILURE_MESSAGE } from '../../services/admin/adminAuthService';
import { requireAdmin, requireAdminMutationOrigin } from '../../middleware/adminAuth';
import { adminLoginSchema } from '../../schemas/adminSchemas';
import { validate } from '../../middleware/validate';

const router = express.Router();
const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, path: '/api/admin', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 };
const clientIp = (req: express.Request) => req.ip || req.socket.remoteAddress || 'unknown';
router.post('/login', requireAdminMutationOrigin, validate(adminLoginSchema), async (req, res) => { try { const result = await authenticateAdmin({ ...req.body, ip: clientIp(req), requestId: req.requestId }); res.cookie('nwai_admin_session', result.token, cookieOptions).status(200).json({ admin: result.admin }); } catch { res.status(401).json({ error: ADMIN_LOGIN_FAILURE_MESSAGE }); } });
router.post('/logout', requireAdminMutationOrigin, (_req, res) => { res.clearCookie('nwai_admin_session', { ...cookieOptions, maxAge: undefined }).status(204).end(); });
router.get('/me', requireAdmin, (req, res) => { res.json({ admin: req.admin }); });
export default router;

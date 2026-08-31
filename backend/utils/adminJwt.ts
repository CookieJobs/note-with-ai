import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AdminRole } from '../models/AdminAccount';

export type AdminJwtPayload = {
  typ: 'admin';
  adminId: string;
  role: AdminRole;
  tokenVersion: number;
};

export function signAdminToken(payload: AdminJwtPayload): string {
  return jwt.sign(payload, config.ADMIN_JWT_SECRET, { expiresIn: config.ADMIN_JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  const payload = jwt.verify(token, config.ADMIN_JWT_SECRET);
  if (!payload || typeof payload !== 'object' || payload.typ !== 'admin'
    || typeof payload.adminId !== 'string' || typeof payload.tokenVersion !== 'number') {
    throw new Error('Invalid admin session');
  }
  return payload as AdminJwtPayload;
}

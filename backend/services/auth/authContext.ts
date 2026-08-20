import { Request } from 'express';

export interface AuthRequestContext {
  email?: string;
  ip: string;
  userAgent?: string;
}

export function normalizeEmail(email: string): string {
  return String(email).trim().toLowerCase();
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.ip || '127.0.0.1';
}

export function buildAuthRequestContext(
  req: Request,
  overrides?: Partial<AuthRequestContext>
): AuthRequestContext {
  const rawEmail = overrides?.email ?? req.body?.email;
  const normalizedEmail =
    typeof rawEmail === 'string' && rawEmail.trim().length > 0
      ? normalizeEmail(rawEmail)
      : undefined;

  return {
    email: normalizedEmail,
    ip: overrides?.ip ?? getClientIp(req),
    userAgent:
      overrides?.userAgent ??
      (typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined),
  };
}

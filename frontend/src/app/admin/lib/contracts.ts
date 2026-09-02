export type AdminRole = 'owner' | 'operator' | 'support' | 'viewer';
export type AdminIdentity = { id: string; email: string; displayName: string; role: AdminRole };
export type AdminUser = { id: string; username: string; maskedEmail: string; email?: string; isActive: boolean; isVerified: boolean; createdAt: string; lastActiveAt: string | null; noteCount: number; chatCount: number; aiCalls30d: number; aiKnownTokens30d: number };
export class AdminApiError extends Error { constructor(public status: number, public code?: string, message = '请求失败') { super(message); } }

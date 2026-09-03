export type AdminRole = 'owner' | 'operator' | 'support' | 'viewer';
export type AdminIdentity = { id: string; email: string; displayName: string; role: AdminRole };
export type Pagination = { page: number; limit: number; total: number; hasNext: boolean };
export type ListResponse<T> = { items: T[]; pagination: Pagination };
export type AdminUser = { id: string; username: string; maskedEmail: string; email?: string; isActive: boolean; isVerified: boolean; createdAt: string; lastActiveAt: string | null; noteCount: number; chatCount: number; aiCalls30d: number; aiKnownTokens30d: number };
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved';
export type FeedbackCategory = 'bug' | 'experience' | 'feature' | 'billing' | 'other';
export type Feedback = { id: string; status: FeedbackStatus; category: FeedbackCategory; content: string; userId: string; internalNote: string; assignedTo: string | null; createdAt: string; updatedAt?: string | null };
export type AuditStatus = 'pending' | 'succeeded' | 'failed';
export type Audit = { id: string; action: string; status: AuditStatus; targetType: string | null; targetId: string | null; actor: { id: string | null; displayName: string }; metadata: Record<string, string | number | boolean | null>; createdAt: string };
export type UsageGroup = { provider: string; operation: string; calls: number; succeeded: number; inputTokens: number | null; outputTokens: number | null; knownTokenCalls?: number; costKnownCalls?: number; estimatedCostMicros: number | null };
export type FailedArtifact = { noteId: string; userId: string; artifact: string; sourceRevision: number; currentRevision: number; attemptedAt?: string; errorCode: string | null };
export type Overview = { summary: Record<string, number | null>; timeseries: Array<{ day: string; value: number }>; retention: { d1: number | null; d7: number | null; d30: number | null }; tokenCoverage: { totalTokens?: number; inputTokens?: number; outputTokens?: number; rate: number | null }; costCoverage: { estimatedCostMicros: number | null; rate: number | null } };
export type AiUsage = { groups: UsageGroup[]; range: '7d' | '30d' };
export class AdminApiError extends Error { constructor(public status: number, public code?: string, message = '请求失败') { super(message); this.name = 'AdminApiError'; } }

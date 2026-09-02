import { AdminAuditLog } from '../../models/AdminAuditLog';
import { logger } from '../../utils/logger';

export type AuditCommandInput = {
  actorId?: string;
  requestId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  resultMetadata?: Record<string, string | number | boolean | null>;
};

const SAFE_METADATA_KEYS = new Set(['reason', 'outcome', 'ip', 'emailHash', 'permission', 'status', 'previousStatus', 'nextStatus', 'changedFields', 'sourceRevision', 'idempotent', 'count', 'retryStatus']);
type SafeValue = string | number | boolean | null;
function safeMetadata(metadata: Record<string, SafeValue> | undefined): Record<string, SafeValue> | undefined {
  if (!metadata) return undefined;
  const result: Record<string, SafeValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SAFE_METADATA_KEYS.has(key) && (typeof value !== 'string' || value.length <= 256)) result[key] = value;
  }
  return result;
}

function normalizedErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 100);
  }
  return 'ADMIN_COMMAND_FAILED';
}

export async function runAuditedAdminCommand<T>(input: AuditCommandInput, command: () => Promise<T>): Promise<T> {
  const commandMetadata = safeMetadata(input.metadata);
  const resultMetadata = safeMetadata(input.resultMetadata);
  const audit = await AdminAuditLog.create({ ...input, status: 'pending', metadata: { command: commandMetadata } });
  let result: T;
  try {
    result = await command();
  } catch (error) {
    await AdminAuditLog.updateOne({ _id: audit._id }, { $set: { status: 'failed', errorCode: normalizedErrorCode(error) } });
    throw error;
  }
  // If this update fails the command has already run. Preserve `pending` to
  // represent the uncertainty; never rewrite immutable history as `failed`.
  const actualResult = result && typeof result === 'object' ? result as Record<string, SafeValue> : {};
  await AdminAuditLog.updateOne({ _id: audit._id }, { $set: { status: 'succeeded', metadata: { command: commandMetadata, result: safeMetadata({ ...resultMetadata, ...actualResult }) } } });
  return result;
}

export async function recordAdminSecurityAudit(input: AuditCommandInput & { status: 'succeeded' | 'failed' }): Promise<void> {
  try {
    await AdminAuditLog.create({ ...input, metadata: safeMetadata(input.metadata) });
  } catch (error: unknown) {
    // Auditing an authentication/authorization denial must never change its result.
    // A server-generated request ID prevents normal collisions; duplicates are safe to ignore.
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return;
    const safe = safeMetadata(input.metadata);
    logger.error(JSON.stringify({
      event: 'admin_security_audit_persistence_failed', code: normalizedErrorCode(error),
      requestId: input.requestId, action: input.action, outcome: safe?.outcome ?? 'unknown',
    }));
  }
}

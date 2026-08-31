import { AdminAuditLog } from '../../models/AdminAuditLog';

export type AuditCommandInput = {
  actorId?: string;
  requestId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  resultMetadata?: Record<string, string | number | boolean | null>;
};

function normalizedErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 100);
  }
  return 'ADMIN_COMMAND_FAILED';
}

export async function runAuditedAdminCommand<T>(input: AuditCommandInput, command: () => Promise<T>): Promise<T> {
  const audit = await AdminAuditLog.create({ ...input, status: 'pending', metadata: input.metadata });
  try {
    const result = await command();
    await AdminAuditLog.updateOne({ _id: audit._id }, { $set: { status: 'succeeded', metadata: input.resultMetadata ?? input.metadata } });
    return result;
  } catch (error) {
    await AdminAuditLog.updateOne({ _id: audit._id }, { $set: { status: 'failed', errorCode: normalizedErrorCode(error) } });
    throw error;
  }
}

export async function recordAdminSecurityAudit(input: AuditCommandInput & { status: 'succeeded' | 'failed' }): Promise<void> {
  await AdminAuditLog.create(input);
}

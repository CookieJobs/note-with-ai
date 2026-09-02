import mongoose from 'mongoose';
import { Note } from '../../models/Note';
import AiUsageEvent from '../../models/AiUsageEvent';
import { runProductionNoteEnrichmentTask } from '../noteEnrichmentWorker';
import { ErrorHandler } from '../../utils/errorHandler';

export const ADMIN_ARTIFACTS = ['meta', 'embedding', 'recommendations'] as const;
export type AdminArtifact = typeof ADMIN_ARTIFACTS[number];
export function toFailedArtifactView(note: any, artifact: AdminArtifact): Record<string, unknown> {
  const state = note.enrichment?.[artifact];
  return { noteId: String(note._id), userId: String(note.userId), artifact, sourceRevision: state.sourceRevision, currentRevision: note.revision, attemptedAt: state.attemptedAt, errorCode: state.errorCode ?? null };
}
export function toUsageSummary(rows: any[]): Record<string, unknown>[] { return rows.map((row) => { const calls = Number(row.calls ?? 0); const knownTokenCalls = Number(row.knownTokenCalls ?? 0); const costKnownCalls = Number(row.costKnownCalls ?? (row.costKnown === undefined && row.cost != null ? 1 : 0)); return { provider: row._id?.provider, operation: row._id?.operation, calls, succeeded: Number(row.succeeded ?? 0), inputTokens: knownTokenCalls === calls ? Number(row.inputTokens ?? 0) : null, outputTokens: knownTokenCalls === calls ? Number(row.outputTokens ?? 0) : null, knownTokenCalls, costKnownCalls, estimatedCostMicros: costKnownCalls > 0 ? Number(row.cost ?? 0) : null }; }); }

export async function getAiUsage(input: { range: '7d' | '30d' }) {
  const days = input.range === '7d' ? 7 : input.range === '30d' ? 30 : 0; if (!days) throw ErrorHandler.createValidationError('range must be 7d or 30d');
  const since = new Date(Date.now() - days * 86400000);
  const rows = await AiUsageEvent.aggregate([{ $match: { startedAt: { $gte: since } } }, { $group: { _id: { provider: '$provider', operation: '$operation' }, calls: { $sum: 1 }, succeeded: { $sum: { $cond: [{ $eq: ['$status', 'succeeded'] }, 1, 0] } }, inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } }, outputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } }, knownTokenCalls: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'succeeded'] }, { $ne: ['$inputTokens', null] }, { $ne: ['$outputTokens', null] }] }, 1, 0] } }, costKnownCalls: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'succeeded'] }, { $ne: ['$estimatedCostMicros', null] }] }, 1, 0] } }, cost: { $sum: { $ifNull: ['$estimatedCostMicros', 0] } } } }, { $sort: { '_id.provider': 1, '_id.operation': 1 } }]);
  return { range: input.range, groups: toUsageSummary(rows) };
}

export async function listFailedArtifacts(input: { page?: number; limit?: number }) {
  const page = Math.max(1, input.page ?? 1); const limit = Math.min(100, Math.max(1, input.limit ?? 20));
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit > 100))) throw ErrorHandler.createValidationError('分页参数无效');
  const pipeline = [{ $project: { noteId: '$_id', userId: 1, currentRevision: '$revision', artifacts: { $objectToArray: '$enrichment' } } }, { $unwind: '$artifacts' }, { $match: { 'artifacts.v.status': 'failed', 'artifacts.k': { $in: ADMIN_ARTIFACTS } } }, { $sort: { 'artifacts.v.attemptedAt': -1 } }];
  const [rows, countRows] = await Promise.all([Note.aggregate([...pipeline, { $skip: (page - 1) * limit }, { $limit: limit }] as any), Note.aggregate([...pipeline, { $count: 'total' }] as any)]);
  const items = rows.map((row: any) => ({ noteId: String(row.noteId), userId: String(row.userId), artifact: row.artifacts.k, sourceRevision: row.artifacts.v.sourceRevision, currentRevision: row.currentRevision, attemptedAt: row.artifacts.v.attemptedAt, errorCode: row.artifacts.v.errorCode ?? null }));
  const total = Number(countRows[0]?.total ?? 0);
  return { items, pagination: { page, limit, total, hasNext: page * limit < total } };
}

export async function retryFailedArtifact(input: { noteId: string; artifact: AdminArtifact; expectedRevision: number; reason: string }) {
  if (!mongoose.Types.ObjectId.isValid(input.noteId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.reason.trim().length < 5 || input.reason.trim().length > 200) throw ErrorHandler.createValidationError('重试参数无效');
  if (!ADMIN_ARTIFACTS.includes(input.artifact)) throw ErrorHandler.createValidationError('artifact 无效');
  const note: any = await Note.findOne({ _id: input.noteId, revision: input.expectedRevision }).select('_id userId revision enrichment').lean();
  if (!note || note.enrichment?.[input.artifact]?.status !== 'failed' || note.enrichment?.[input.artifact]?.sourceRevision !== input.expectedRevision) throw ErrorHandler.createValidationError('任务已过期或不可重试');
  const path = `enrichment.${input.artifact}`;
  const update = await Note.updateOne({ _id: input.noteId, revision: input.expectedRevision, [`${path}.status`]: 'failed', [`${path}.sourceRevision`]: input.expectedRevision }, { $set: { [path]: { status: 'pending', sourceRevision: input.expectedRevision, attemptedAt: new Date() } } }, { timestamps: false });
  if (!update.matchedCount) throw ErrorHandler.createValidationError('任务已过期或不可重试');
  const status = await runProductionNoteEnrichmentTask({ noteId: input.noteId, userId: String(note.userId), artifact: input.artifact, sourceRevision: input.expectedRevision });
  return { retryStatus: status };
}

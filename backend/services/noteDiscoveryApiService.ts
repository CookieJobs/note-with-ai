import { NoteDiscoveryCleanup, isDiscoveryUserCleaningUp } from '../models/NoteDiscoveryCleanup';
import { noteDiscoveryBudgetService } from './noteDiscoveryBudgetService';
import mongoose, { Types } from 'mongoose';
import { config } from '../config';
import NoteDiscovery from '../models/NoteDiscovery';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import NoteDiscoveryPreference from '../models/NoteDiscoveryPreference';
import { NoteDiscoveryAction } from '../models/NoteDiscoveryAction';
import { NoteDiscoveryChatTurn } from '../models/NoteDiscoveryChatTurn';
import Chat from '../models/Chat';
import { Note } from '../models/Note';
import { noteWriteModule, toNoteDto } from './NoteUpdateOrchestrator';
import { noteDiscoveryScheduleService, discoveryLocalDate } from './noteDiscoveryScheduleService';
import { canUseDiscovery } from './noteDiscoveryService';
import { chatService } from './chatService';
import { chatTurnCommitService } from './chatTurnCommitService';
import { AppError, ErrorType } from '../utils/errorHandler';
import { serializeDiscovery, DISCOVERY_FEEDBACK_KINDS, type DiscoveryFeedbackKind, type DiscoveryListDto, type DiscoveryRunDto } from '../types/noteDiscovery';

const writeConcern = { w: 'majority', j: true } as const;
const exposureSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  version: { type: Number, default: 0 },
  receipts: [{ _id: false, discoveryId: { type: mongoose.Schema.Types.ObjectId, required: true }, at: { type: Date, required: true } }],
});
export const NoteDiscoveryExposure = mongoose.models.NoteDiscoveryExposure || mongoose.model('NoteDiscoveryExposure', exposureSchema);
const error = (message: string, code: string, status = 400) => new AppError(message, ErrorType.VALIDATION, status, true, { code });
function validId(id: string) { if (!Types.ObjectId.isValid(id)) throw error('发现不存在或无权限', 'DISCOVERY_UNAVAILABLE', 404); }

export class NoteDiscoveryApiService {
  constructor(private readonly options: { schedule?: typeof noteDiscoveryScheduleService; enabled?: () => boolean; now?: () => Date } = {}) {}
  private get schedule() { return this.options.schedule ?? noteDiscoveryScheduleService; }
  private now() { return this.options.now?.() ?? new Date(); }
  private enabled() { return this.options.enabled?.() ?? config.NOTE_DISCOVERY_RUNNABLE; }
  private async owned(userId: string, id: string) {
    validId(id);
    await this.assertActive(userId);
    const item = await NoteDiscovery.findOne({ _id: id, userId });
    if (!item) throw error('发现不存在或无权限', 'DISCOVERY_UNAVAILABLE', 404);
    return item;
  }
  private async usable(userId: string, item: any) {
    if (!await canUseDiscovery(userId, item)) throw error('来源已变化或不可访问，请重新寻找发现', 'DISCOVERY_STALE', 409);
  }
  private async assertActive(userId: string) {
    if (await isDiscoveryUserCleaningUp(userId)) {
      await eraseDiscoveryUserData(userId);
      throw error('账号发现数据正在清理，当前不可用', 'DISCOVERY_CLEANUP', 409);
    }
  }
  async list(userId: string, options: { history?: boolean; timeZone?: string } = {}): Promise<DiscoveryListDto> {
    await this.assertActive(userId);
    let admission;
    try { admission = await this.schedule.initializeOnVisit(userId, options.timeZone, this.now()); }
    catch (e) { throw error(e instanceof Error && /zone/i.test(e.message) ? '请选择有效的时区' : '暂时无法读取发现状态，请稍后重试', 'DISCOVERY_STATUS_UNAVAILABLE'); }
    const preference = await NoteDiscoveryPreference.findOne({ userId }).lean();
    const timeZone = preference?.timeZone || 'Asia/Shanghai';
    const records = await NoteDiscovery.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(100);
    const items = [];
    for (const item of records) {
      const feedback = preference?.feedback.find(f => String(f.discoveryId) === item.id && !f.revokedAt
        && (!f.expiresAt || f.expiresAt > this.now()));
      item.status = feedback ? (feedback.kind === 'already_finished' ? 'completed' : 'dismissed')
        : item.status === 'stale' ? 'stale' : 'ready';
      if (!options.history && item.status !== 'ready') continue;
      // Even history never reveals stale/deleted/foreign current evidence or unpublished candidates.
      if (!await canUseDiscovery(userId, item)) continue;
      if (!item.exposedAt) {
        if (!options.history) {
          const at = await this.expose(userId, item.id, timeZone);
          if (!at) continue;
          item.exposedAt = at;
          await NoteDiscovery.updateOne({ _id: item._id, userId, exposedAt: { $exists: false } }, { $set: { exposedAt: at } }, { writeConcern });
        }
      }
      if (await canUseDiscovery(userId, item)) items.push(serializeDiscovery(item));
    }
    await this.assertActive(userId);
    const latest = admission.currentRun || await NoteDiscoveryRun.findOne({ userId }).sort({ createdAt: -1 }).lean();
    let run: DiscoveryRunDto = { status: 'idle' };
    if (latest) {
      const status = latest.status === 'cancelled' ? 'idle'
        : latest.failureCategory === 'budget_exhausted' ? 'budget_exhausted' : latest.status;
      run = { status, ...(latest.failureCategory ? { errorCode: latest.failureCategory } : {}),
        ...(admission.retryAt ? { retryAt: admission.retryAt.toISOString() }
          : latest.status === 'queued' && latest.availableAt ? { retryAt: latest.availableAt.toISOString() } : {}) };
    }
    if (admission.status === 'blocked') run = { status: 'idle', errorCode: 'DISCOVERY_DELIVERY_UNCERTAIN' };
    return { items, run, automaticEnabled: preference?.automaticEnabled ?? true, timeZone, available: this.enabled() };
  }
  private async expose(userId: string, discoveryId: string, timeZone: string): Promise<Date | null> {
    try { await NoteDiscoveryExposure.updateOne({ userId }, { $setOnInsert: { receipts: [], version: 0 } }, { upsert: true, writeConcern }); }
    catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
    for (let attempt = 0; attempt < 30; attempt++) {
      await this.assertActive(userId);
      const current: any = await NoteDiscoveryExposure.findOne({ userId }).lean();
      if (!current) { await this.assertActive(userId); throw error('发现正在更新，请稍后重试', 'DISCOVERY_BUSY', 409); }
      const existing = current.receipts.find((r: any) => String(r.discoveryId) === discoveryId);
      if (existing) return existing.at;
      const now = this.now();
      const day = discoveryLocalDate(now, timeZone);
      const receipts = current.receipts.filter((r: any) => now.getTime() - new Date(r.at).getTime() < 48 * 3600_000);
      if (receipts.filter((r: any) => discoveryLocalDate(new Date(r.at), timeZone) === day).length >= 3) return null;
      const result = await NoteDiscoveryExposure.updateOne({ _id: current._id, version: current.version },
        { $set: { receipts: [...receipts, { discoveryId: new Types.ObjectId(discoveryId), at: now }] }, $inc: { version: 1 } }, { writeConcern });
      if (result.modifiedCount) {
        if (await isDiscoveryUserCleaningUp(userId)) {
          await NoteDiscoveryExposure.deleteMany({ userId });
          await this.assertActive(userId);
        }
        return now;
      }
    }
    throw error('发现正在更新，请稍后重试', 'DISCOVERY_BUSY', 409);
  }
  async run(userId: string, key: string) {
    await this.assertActive(userId);
    if (typeof key !== 'string' || !key.trim() || key.length > 150) throw error('请提供有效请求标识', 'DISCOVERY_REQUEST_ID_REQUIRED');
    const result = await this.schedule.requestManual(userId, key, this.now());
    if (result.status === 'disabled') throw error('笔记发现暂未开启', 'DISCOVERY_DISABLED', 503);
    if (result.status === 'blocked') throw error('上次请求结果尚无法确认，请稍后重新发起', 'DISCOVERY_DELIVERY_UNCERTAIN', 409);
    if (result.status === 'limited') throw error('本次寻找发现的次数已达上限，请稍后再试', 'DISCOVERY_RATE_LIMITED', 429);
    if (!result.currentRun) throw error('暂时无法发起发现，请稍后重试', 'DISCOVERY_RUN_UNAVAILABLE', 503);
    return { runId: String(result.currentRun._id), status: result.currentRun.status,
      ...(result.retryAt ? { retryAt: result.retryAt.toISOString() } : {}) };
  }
  async preferences(userId: string, input: { automaticEnabled?: boolean; timeZone?: string }) {
    await this.assertActive(userId);
    if (input.timeZone !== undefined) await this.schedule.initializeOnVisit(userId, input.timeZone, this.now());
    if (input.automaticEnabled !== undefined) await this.schedule.setAutomaticEnabled(userId, input.automaticEnabled, this.now());
    const preference = await NoteDiscoveryPreference.findOne({ userId }).lean();
    return { automaticEnabled: preference?.automaticEnabled ?? true, timeZone: preference?.timeZone || 'Asia/Shanghai', available: this.enabled() };
  }
  async feedback(userId: string, id: string, kind: DiscoveryFeedbackKind) {
    if (!DISCOVERY_FEEDBACK_KINDS.includes(kind)) throw error('请选择有效的反馈类型', 'DISCOVERY_FEEDBACK_INVALID');
    const item = await this.owned(userId, id);
    await this.usable(userId, item);
    await this.schedule.initializeOnVisit(userId, undefined, this.now());
    const now = this.now();
    const feedback = { kind, discoveryId: item._id, sourceIds: [...new Set(item.evidence.map(e => String(e.noteId)))].map(id => new Types.ObjectId(id)),
      sourceFingerprint: item.sourceFingerprint, observationFingerprint: item.observationFingerprint,
      ...(item.relationshipKey ? { relationshipKey: item.relationshipKey } : {}),
      ...(item.questionKey ? { questionKey: item.questionKey } : {}),
      ...(kind === 'not_related' && item.sourceBodyBaselines ? { sourceBodyBaselines: item.sourceBodyBaselines } : {}),
      createdAt: now, ...(kind === 'not_interested' ? { expiresAt: new Date(now.getTime() + 30 * 86400_000) } : {}) };
    // One atomic pipeline replaces this discovery's prior feedback; concurrent double clicks stay idempotent.
    await NoteDiscoveryPreference.updateOne({ userId }, [{ $set: { feedback: { $concatArrays: [
      { $filter: { input: '$feedback', as: 'f', cond: { $ne: ['$$f.discoveryId', item._id] } } }, { $literal: [feedback] },
    ] } } }], { writeConcern });
    await this.assertActive(userId);
    return { kind, discoveryId: id, createdAt: now.toISOString(), ...(feedback.expiresAt ? { expiresAt: feedback.expiresAt.toISOString() } : {}) };
  }
  async revokeFeedback(userId: string, id: string) {
    const item = await this.owned(userId, id);
    await NoteDiscoveryPreference.updateOne({ userId }, { $set: { 'feedback.$[f].revokedAt': this.now() } },
      { arrayFilters: [{ 'f.discoveryId': item._id, 'f.revokedAt': { $exists: false } }], writeConcern });
    await this.assertActive(userId);
    return { revoked: true };
  }
  private async action(userId: string, discoveryId: string, kind: 'session' | 'save', payload: unknown) {
    let action;
    try { action = await NoteDiscoveryAction.create([{ userId, discoveryId, kind, targetId: new Types.ObjectId(), payload }], { writeConcern }).then(rows => rows[0]); }
    catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      action = (await NoteDiscoveryAction.findOne({ userId, discoveryId, kind }))!;
    }
    await this.assertActive(userId);
    return action;
  }

  async session(userId: string, id: string) {
    const item = await this.owned(userId, id);
    let action: any = await NoteDiscoveryAction.findOne({ userId, discoveryId: id, kind: 'session' });
    let existing = action ? await Chat.findOne({ _id: action.targetId, userId }) : null;
    if (!existing) {
      if (!this.enabled()) throw error('笔记发现暂未开启', 'DISCOVERY_DISABLED', 503);
      await this.usable(userId, item);
      action = await this.action(userId, id, 'session', { title: item.title,
        sourceIds: [...new Set(item.evidence.map(e => String(e.noteId)))],
        opening: `发现：${item.observation}\n为什么现在：${item.whyNow}\n边界：${item.qualification}\n请直接推进这个行动：${item.suggestedAction}` });
      try {
        existing = await Chat.findOneAndUpdate({ _id: action.targetId, userId }, { $setOnInsert: {
          userId, title: action.payload.title, sourceMode: 'multi_note_discovery', discoveryId: item._id,
          selectedSourceIds: action.payload.sourceIds, messages: [],
        } }, { upsert: true, new: true, runValidators: true, writeConcern });
      } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; existing = await Chat.findOne({ _id: action.targetId, userId }); }
    }
    if (!existing || existing.sourceMode !== 'multi_note_discovery' || String(existing.discoveryId) !== id) throw error('会话来源不匹配', 'DISCOVERY_SESSION_CONFLICT', 409);
    if (await isDiscoveryUserCleaningUp(userId)) {
      await Chat.deleteOne({ _id: existing._id, userId });
      await NoteDiscoveryAction.deleteMany({ userId });
      throw error('账号发现数据正在清理，当前不可用', 'DISCOVERY_CLEANUP', 409);
    }
    await NoteDiscovery.updateOne({ _id: item._id, userId }, { $set: { sessionId: existing._id } }, { writeConcern });
    const reused = existing.messages.length > 0;
    if (!existing.messages.length) {
      const committed = await chatTurnCommitService.streamAndCommit({ userId, sessionId: String(existing._id), requestId: 'discovery-initial',
        messages: [{ role: 'user', content: action.payload.opening }], title: existing.title, onChunk: () => true });
      return { session: committed.session, reused: false };
    }
    return { session: chatService.formatSession(existing as any), reused };
  }
  async save(userId: string, id: string, input: { text: string; title?: string; idempotencyKey: string }) {
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 150) throw error('请提供有效请求标识', 'DISCOVERY_REQUEST_ID_REQUIRED');
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000) throw error('请确认要保存的草稿正文（最多 16000 字）', 'DISCOVERY_DRAFT_INVALID');
    const item = await this.owned(userId, id);
    await this.usable(userId, item);
    const action = await this.action(userId, id, 'save', { text: input.text.trim(), title: input.title || item.title, idempotencyKey: input.idempotencyKey });
    await this.usable(userId, item);
    await this.assertActive(userId);
    let note;
    if (action.completedAt) {
      const existing = await Note.findOne({ _id: action.targetId, userId });
      if (!existing) throw error('已保存的笔记已删除，不会重复创建', 'DISCOVERY_SAVED_NOTE_DELETED', 410);
      note = toNoteDto(existing as any);
    } else {
      const result = await noteWriteModule.create({ userId, body: { kind: 'plain-text', text: action.payload.text }, title: action.payload.title, stableNoteId: String(action.targetId) });
      if (await isDiscoveryUserCleaningUp(userId)) {
        // Persist this exact pending target before compensation; a crash is repaired by the worker.
        await NoteDiscoveryCleanup.updateOne({ userId }, { $addToSet: { cancelledSaveTargets: action.targetId } }, { writeConcern });
        await Note.deleteOne({ _id: action.targetId, userId });
        await this.assertActive(userId);
      }
      await NoteDiscoveryAction.updateOne({ _id: action._id, userId }, { $set: { completedAt: this.now() } }, { writeConcern });
      note = result.note;
    }
    await this.assertActive(userId);
    item.savedNoteId = action.targetId;
    await NoteDiscovery.updateOne({ _id: item._id, userId }, { $set: { savedNoteId: action.targetId } }, { writeConcern });
    return { note, discovery: serializeDiscovery(item) };
  }
  async cleanupUser(userId: string): Promise<void> {
    validId(userId);
    try { await NoteDiscoveryCleanup.updateOne({ userId }, { $setOnInsert: { requestedAt: this.now() } }, { upsert: true, writeConcern }); }
    catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
    await recoverDiscoveryUserCleanup(userId);
  }
}

/** Replaying a durable marker repeats erasure, including writes that raced the initial pass. */
async function eraseDiscoveryUserData(userId: string): Promise<void> {
  await NoteDiscoveryRun.updateMany({ userId }, { $set: { executionCancelled: true, cleanupRequested: true },
    $unset: { pendingWatermark: 1, pendingIdempotencyKey: 1, pendingAvailableAt: 1, pendingTrigger: 1 } }, { writeConcern });
  await NoteDiscoveryChatTurn.collection.updateMany({ userId: new Types.ObjectId(userId) }, [
    { $set: { executionCancelled: true, cleanupRequested: true, requestId: { $concat: ['cleanup:', { $toString: '$_id' }] } } },
    { $unset: ['payload', 'reply'] },
  ], { writeConcern });
  const pending = await NoteDiscoveryAction.find({ userId, kind: 'save', completedAt: { $exists: false } }).select('targetId').lean();
  if (pending.length) await NoteDiscoveryCleanup.updateOne({ userId },
    { $addToSet: { cancelledSaveTargets: { $each: pending.map(a => a.targetId) } } }, { writeConcern });
  const marker: any = await NoteDiscoveryCleanup.findOne({ userId }).lean();
  if (marker?.cancelledSaveTargets?.length) await Note.deleteMany({ userId, _id: { $in: marker.cancelledSaveTargets } });
  await Promise.all([NoteDiscovery.deleteMany({ userId }), NoteDiscoveryPreference.deleteMany({ userId }),
    NoteDiscoveryAction.deleteMany({ userId }), NoteDiscoveryExposure.deleteMany({ userId }),
    Chat.deleteMany({ userId, sourceMode: 'multi_note_discovery' })]);
}

export async function recoverDiscoveryUserCleanup(userId?: string): Promise<number> {
  let examined = 0;
  const tombstones = NoteDiscoveryCleanup.find(userId ? { userId } : {}).lean().cursor({ batchSize: 100 });
  for await (const tombstone of tombstones) {
    examined += 1;
    const owner = tombstone.userId;
    await eraseDiscoveryUserData(String(owner));
    const runs = await NoteDiscoveryRun.find({ userId: owner, cleanupRequested: true }).select('_id').limit(100).lean();
    const turns = await NoteDiscoveryChatTurn.find({ userId: owner, cleanupRequested: true }).select('_id').limit(100).lean();
    for (const run of runs) await noteDiscoveryBudgetService.recoverCleanupOperation('discovery', String(run._id));
    for (const turn of turns) await noteDiscoveryBudgetService.recoverCleanupOperation('conversation', String(turn._id));
  }
  return examined;
}
export const noteDiscoveryApiService = new NoteDiscoveryApiService();

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { Note } from '../models/Note';
import UserNoteTopicIndex, { type TopicScope } from '../models/UserNoteTopicIndex';
import UserNoteTopicWorkerLease from '../models/UserNoteTopicWorkerLease';
import { buildTopicInputs, normalizeTopicLabel, type TopicInputNote, type TopicInputs } from './userNoteTopicInputs';

const TEN_MINUTES = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;

export interface TopicNote extends TopicInputNote {
  _id: string;
  userId: string;
  createdAt?: Date;
}

export interface TopicJob {
  userId: string;
  noteId: string;
  sourceRevision: number;
  sourceFingerprint: string;
  source: TopicInputs['source'];
  promptText: string;
  candidateTopics: string[];
  mode: 'automatic' | 'manual';
  attemptNumber: number;
  claimToken: string;
  claimVersion: number;
  claimUntil: Date;
}

export interface TopicStore {
  getNote(userId: string, noteId: string): Promise<TopicNote | null>;
  schedule(userId: string, note: TopicNote, inputs: TopicInputs, now: Date): Promise<void>;
  claimUserLease(userId: string, token: string, now: Date): Promise<boolean>;
  releaseUserLease(userId: string, token: string): Promise<void>;
  claimNext(userId: string, token: string, now: Date, mode?: 'automatic' | 'manual'): Promise<TopicJob | null>;
  finish(job: TopicJob, topics: string[], now: Date): Promise<boolean>;
  fail(job: TopicJob, errorCode: string, now: Date): Promise<void>;
  retryFailed(userId: string, scope: TopicScope, now: Date): Promise<RetryFailedResult>;
}

export interface RetryFailedResult {
  acceptedCount: number;
  alreadyRunningCount: number;
  rateLimitedCount: number;
  nextRetryAt: string | null;
}

function noteProjection(note: any): TopicNote {
  return {
    _id: String(note._id), userId: String(note.userId), revision: note.revision,
    title: note.title, content: note.content, contentText: note.contentText,
    summary: note.summary, keywords: note.keywords, createdAt: note.createdAt,
  };
}

function sourceFilter(note: TopicNote, inputs: TopicInputs): Record<string, unknown> {
  // Compare both revision and every fingerprint input; revision alone misses async metadata edits.
  const exact = (value: unknown) => value === undefined ? { $exists: false } : value;
  return {
    _id: new mongoose.Types.ObjectId(note._id),
    userId: new mongoose.Types.ObjectId(note.userId),
    revision: inputs.sourceRevision,
    title: exact(note.title), content: exact(note.content), contentText: exact(note.contentText),
    summary: exact(note.summary), keywords: exact(note.keywords),
  };
}

export function topicScopeStartAt(scope: TopicScope, now: Date): Date | null {
  if (scope === 'all') return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  let year = part('year');
  let month = part('month');
  const day = part('day');
  if (scope === 'year') year--;
  else {
    month -= 6;
    while (month <= 0) { month += 12; year--; }
  }
  const clippedDay = Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate());
  // Shanghai calendar midnight is UTC+08:00; China has no current DST transition.
  return new Date(Date.UTC(year, month - 1, clippedDay) - 8 * 60 * 60 * 1000);
}

export function topicScopeEndAt(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + 1) - 8 * 60 * 60 * 1000);
}

export function noteMatchesTopicScope(noteDate: Date, scope: TopicScope, now: Date): boolean {
  const start = topicScopeStartAt(scope, now);
  return (start === null || noteDate >= start) && noteDate < topicScopeEndAt(now);
}

export class MongoTopicStore implements TopicStore {
  async getNote(userId: string, noteId: string): Promise<TopicNote | null> {
    const note = await Note.findOne({ _id: noteId, userId }).lean();
    return note ? noteProjection(note) : null;
  }

  async schedule(userId: string, note: TopicNote, inputs: TopicInputs, now: Date): Promise<void> {
    const id = new mongoose.Types.ObjectId(note._id);
    const uid = new mongoose.Types.ObjectId(userId);
    const scheduled: any = await Note.findOneAndUpdate(
      sourceFilter(note, inputs),
      [{ $set: {
        topicIndexFence: { $add: [{ $ifNull: ['$topicIndexFence', 0] }, 1] },
        topicIndexScheduled: { $literal: { sourceRevision: inputs.sourceRevision, sourceFingerprint: inputs.sourceFingerprint } },
        topicIndexClaimToken: { $cond: [
          { $and: [{ $eq: ['$topicIndexScheduled.sourceRevision', inputs.sourceRevision] }, { $eq: ['$topicIndexScheduled.sourceFingerprint', inputs.sourceFingerprint] }] },
          '$topicIndexClaimToken', null,
        ] },
        topicIndexClaimUntil: { $cond: [
          { $and: [{ $eq: ['$topicIndexScheduled.sourceRevision', inputs.sourceRevision] }, { $eq: ['$topicIndexScheduled.sourceFingerprint', inputs.sourceFingerprint] }] },
          '$topicIndexClaimUntil', null,
        ] },
      } }],
      { new: true, projection: { topicIndexFence: 1 }, timestamps: false },
    ).select('+topicIndexFence').lean();
    // A source edit/deletion after getNote makes this CAS miss. Its later scheduler owns the newer fence.
    if (!scheduled || typeof scheduled.topicIndexFence !== 'number') return;
    const fence = scheduled.topicIndexFence;
    const samePair = { $and: [
      { $eq: ['$sourceRevision', { $literal: inputs.sourceRevision }] },
      { $eq: ['$sourceFingerprint', { $literal: inputs.sourceFingerprint }] },
    ] };
    const canProject = { $lt: [{ $ifNull: ['$projectionFence', 0] }, { $literal: fence }] };
    await UserNoteTopicIndex.findOneAndUpdate(
      { userId: uid, noteId: id },
      [{ $set: {
        userId: { $ifNull: ['$userId', { $literal: uid }] }, noteId: { $ifNull: ['$noteId', { $literal: id }] },
        sourceRevision: { $cond: [canProject, { $literal: inputs.sourceRevision }, '$sourceRevision'] },
        sourceFingerprint: { $cond: [canProject, { $literal: inputs.sourceFingerprint }, '$sourceFingerprint'] },
        status: { $cond: [canProject, { $cond: [samePair, { $ifNull: ['$status', 'pending'] }, 'pending'] }, '$status'] },
        topics: { $cond: [canProject, { $cond: [samePair, { $ifNull: ['$topics', []] }, { $literal: [] }] }, '$topics'] },
        source: { $cond: [canProject, { $literal: inputs.source }, '$source'] },
        automaticAttemptCount: { $cond: [canProject, { $cond: [{ $eq: ['$automaticAttemptFingerprint', { $literal: inputs.sourceFingerprint }] }, { $ifNull: ['$automaticAttemptCount', 0] }, 0] }, '$automaticAttemptCount'] },
        automaticAttemptFingerprint: { $cond: [canProject, { $literal: inputs.sourceFingerprint }, '$automaticAttemptFingerprint'] },
        nextAttemptAt: { $cond: [canProject, { $cond: [samePair, '$nextAttemptAt', { $literal: now }] }, '$nextAttemptAt'] },
        scheduledAt: { $cond: [canProject, { $literal: now }, '$scheduledAt'] }, updatedAt: { $literal: now }, createdAt: { $ifNull: ['$createdAt', { $literal: now }] },
        projectionFence: { $cond: [canProject, { $literal: fence }, { $ifNull: ['$projectionFence', 0] }] },
        manualAttemptTimestamps: { $ifNull: ['$manualAttemptTimestamps', []] },
        retryMode: { $cond: [canProject, { $cond: [samePair, { $ifNull: ['$retryMode', null] }, null] }, '$retryMode'] },
        claimToken: { $cond: [canProject, { $cond: [samePair, { $ifNull: ['$claimToken', null] }, null] }, '$claimToken'] },
        leaseUntil: { $cond: [canProject, { $cond: [samePair, { $ifNull: ['$leaseUntil', null] }, null] }, '$leaseUntil'] },
      } }],
      { upsert: true, new: true },
    );
  }

  async claimUserLease(userId: string, token: string, now: Date): Promise<boolean> {
    const uid = new mongoose.Types.ObjectId(userId);
    try {
      const lease = await UserNoteTopicWorkerLease.findOneAndUpdate(
        { userId: uid, leaseUntil: { $lte: now } },
        { $set: { ownerToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
        { new: true },
      );
      if (lease) return true;
      await UserNoteTopicWorkerLease.create({ userId: uid, ownerToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS) });
      return true;
    } catch (error: any) {
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  async releaseUserLease(userId: string, token: string): Promise<void> {
    await UserNoteTopicWorkerLease.deleteOne({ userId, ownerToken: token });
  }

  async claimNext(userId: string, token: string, now: Date, mode: 'automatic' | 'manual' = 'automatic'): Promise<TopicJob | null> {
    const uid = new mongoose.Types.ObjectId(userId);
    await UserNoteTopicIndex.updateMany({ userId: uid, status: 'processing', leaseUntil: { $lte: now }, $or: [
      { retryMode: 'manual' }, { retryMode: 'automatic', automaticAttemptCount: { $gte: 3 } },
    ] }, { $set: { status: 'failed', errorAt: now, lastErrorCode: 'WORKER_LEASE_EXPIRED', nextAttemptAt: null, claimToken: null, leaseUntil: null } });
    const query: any = {
      userId: uid,
      status: mode === 'manual' ? 'pending' : { $in: ['pending', 'processing'] },
      retryMode: mode === 'manual' ? 'manual' : { $ne: 'manual' },
      nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    };
    if (mode === 'automatic') query.$expr = { $lt: ['$automaticAttemptCount', 3] };
    const claimUntil = new Date(now.getTime() + LEASE_MS);
    const index: any = await UserNoteTopicIndex.findOneAndUpdate(
      query,
      { $set: { status: 'processing', claimToken: token, leaseUntil: claimUntil, retryMode: mode, lastAttemptAt: now }, $inc: { claimVersion: 1, ...(mode === 'automatic' ? { automaticAttemptCount: 1 } : {}) } },
      { new: true, sort: { scheduledAt: 1 } },
    ).lean();
    if (!index) return null;
    const note = await this.getNote(String(index.userId), String(index.noteId));
    if (!note) {
      await UserNoteTopicIndex.updateOne({ _id: index._id, claimToken: token }, { $set: { status: 'pending', claimToken: null, leaseUntil: null, nextAttemptAt: null } });
      return null;
    }
    const inputs = buildTopicInputs(note);
    if (inputs.sourceRevision !== index.sourceRevision || inputs.sourceFingerprint !== index.sourceFingerprint) {
      await UserNoteTopicIndex.updateOne({ _id: index._id, claimToken: token }, { $set: { status: 'pending', claimToken: null, leaseUntil: null, nextAttemptAt: null } });
      return null;
    }
    const modeNow = index.retryMode === 'manual' ? 'manual' : 'automatic';
    const claimVersion = Number(index.claimVersion ?? 0);
    const claimedNote = await Note.updateOne({ ...sourceFilter(note, inputs), $or: [
      { topicIndexClaimVersion: { $lt: claimVersion } }, { topicIndexClaimVersion: { $exists: false } },
    ] }, { $set: { topicIndexClaimToken: token, topicIndexClaimVersion: claimVersion, topicIndexClaimUntil: claimUntil } }, { timestamps: false });
    if (claimedNote.matchedCount !== 1) return null;
    return {
      userId: String(index.userId), noteId: String(index.noteId),
      sourceRevision: index.sourceRevision, sourceFingerprint: index.sourceFingerprint,
      source: inputs.source, promptText: inputs.promptText, candidateTopics: inputs.candidateTopics,
      mode: modeNow, attemptNumber: modeNow === 'automatic' ? index.automaticAttemptCount : (index.manualAttemptTimestamps?.length ?? 1), claimToken: token, claimVersion, claimUntil,
    };
  }

  async finish(job: TopicJob, topics: string[], now: Date): Promise<boolean> {
    const note = await this.getNote(job.userId, job.noteId);
    if (!note) return false;
    const inputs = buildTopicInputs(note);
    if (inputs.sourceRevision !== job.sourceRevision || inputs.sourceFingerprint !== job.sourceFingerprint) return false;
    const normalizedTopics = [...new Set(topics.map(normalizeTopicLabel).filter(Boolean))];
    const snapshot = { sourceRevision: job.sourceRevision, sourceFingerprint: job.sourceFingerprint, topics: normalizedTopics, source: job.source, indexedAt: now };
    // Note is authoritative; this single-document CAS is compatible with standalone Mongo.
    // The index is a projection whose freshness is checked against current Note inputs.
    const authoritative: any = await Note.findOneAndUpdate(
      { ...sourceFilter(note, inputs), topicIndexClaimToken: job.claimToken, topicIndexClaimVersion: job.claimVersion, topicIndexClaimUntil: { $gt: now } },
      { $inc: { topicIndexFence: 1 }, $set: { topicIndexSuccess: snapshot, topicIndexClaimToken: null, topicIndexClaimUntil: null } },
      { new: true, projection: { topicIndexFence: 1 }, timestamps: false },
    ).select('+topicIndexFence').lean();
    if (!authoritative || typeof authoritative.topicIndexFence !== 'number') return false;
    const fence = authoritative.topicIndexFence;
    const projected = await UserNoteTopicIndex.updateOne({ userId: job.userId, noteId: job.noteId, sourceRevision: job.sourceRevision, sourceFingerprint: job.sourceFingerprint, status: 'processing', claimToken: job.claimToken, $or: [{ projectionFence: { $lt: fence } }, { projectionFence: { $exists: false } }] }, {
      $set: { status: 'ready', topics: normalizedTopics, source: job.source, indexedAt: now, errorAt: null, lastErrorCode: null, retryMode: null, nextAttemptAt: null, claimToken: null, leaseUntil: null, projectionFence: fence, lastSuccess: snapshot },
    });
    return projected.matchedCount === 1 || fence > 0;
  }

  async fail(job: TopicJob, errorCode: string, now: Date): Promise<void> {
    const exhausted = job.mode === 'manual' || job.attemptNumber >= 3;
    const delay = job.attemptNumber === 1 ? 30_000 : 120_000;
    const note = await this.getNote(job.userId, job.noteId);
    if (!note) return;
    const inputs = buildTopicInputs(note);
    if (inputs.sourceRevision !== job.sourceRevision || inputs.sourceFingerprint !== job.sourceFingerprint) return;
    const owned = await Note.updateOne({ ...sourceFilter(note, inputs), topicIndexClaimToken: job.claimToken, topicIndexClaimVersion: job.claimVersion, topicIndexClaimUntil: { $gt: now } }, { $set: { topicIndexClaimToken: null, topicIndexClaimUntil: null } }, { timestamps: false });
    if (owned.matchedCount !== 1) return;
    await UserNoteTopicIndex.updateOne({ userId: job.userId, noteId: job.noteId, sourceRevision: job.sourceRevision, sourceFingerprint: job.sourceFingerprint, status: 'processing', claimToken: job.claimToken }, {
      $set: { status: exhausted ? 'failed' : 'pending', errorAt: now, lastErrorCode: errorCode, retryMode: job.mode, nextAttemptAt: exhausted || job.mode === 'manual' ? null : new Date(now.getTime() + delay), claimToken: null, leaseUntil: null },
    });
  }

  async retryFailed(userId: string, scope: TopicScope, now: Date): Promise<RetryFailedResult> {
    const indexes: any[] = await UserNoteTopicIndex.find({ userId, status: { $in: ['failed', 'pending', 'processing'] } }).lean();
    const result: RetryFailedResult = { acceptedCount: 0, alreadyRunningCount: 0, rateLimitedCount: 0, nextRetryAt: null };
    let earliest = Infinity;
    for (const index of indexes) {
      const note = await this.getNote(userId, String(index.noteId));
      if (!note || !noteMatchesTopicScope(note.createdAt ?? now, scope, now)) continue;
      const currentInputs = buildTopicInputs(note);
      if (currentInputs.sourceRevision !== index.sourceRevision || currentInputs.sourceFingerprint !== index.sourceFingerprint) continue;
      if (index.status !== 'failed') { result.alreadyRunningCount++; continue; }
      const cutoff = new Date(now.getTime() - DAY);
      const recent: Date[] = (index.manualAttemptTimestamps ?? []).map((value: Date) => new Date(value)).filter((value: Date) => value > cutoff);
      const cooldownAt = index.lastManualAttemptAt ? new Date(index.lastManualAttemptAt).getTime() + TEN_MINUTES : -Infinity;
      const quotaAt = recent.length >= 3 ? Math.min(...recent.slice(-3).map((value) => value.getTime())) + DAY : -Infinity;
      const allowedAt = Math.max(cooldownAt, quotaAt);
      if (allowedAt > now.getTime()) {
        result.rateLimitedCount++;
        earliest = Math.min(earliest, allowedAt);
        continue;
      }
      const inputs = buildTopicInputs(note);
      const scheduled: any = await Note.findOneAndUpdate(sourceFilter(note, inputs), [{ $set: {
        topicIndexFence: { $add: [{ $ifNull: ['$topicIndexFence', 0] }, 1] },
        topicIndexScheduled: { $literal: { sourceRevision: inputs.sourceRevision, sourceFingerprint: inputs.sourceFingerprint } },
      } }], { new: true, projection: { topicIndexFence: 1 }, timestamps: false }).select('+topicIndexFence').lean();
      if (!scheduled || typeof scheduled.topicIndexFence !== 'number') continue;
      const fence = scheduled.topicIndexFence;
      const pending = await UserNoteTopicIndex.findOneAndUpdate({
        _id: index._id, status: 'failed', sourceRevision: inputs.sourceRevision, sourceFingerprint: inputs.sourceFingerprint,
        manualAttemptTimestamps: index.manualAttemptTimestamps ?? [], lastManualAttemptAt: index.lastManualAttemptAt ?? null,
        $or: [{ projectionFence: { $lt: fence } }, { projectionFence: { $exists: false } }],
      }, {
        $set: { status: 'pending', sourceRevision: inputs.sourceRevision, sourceFingerprint: inputs.sourceFingerprint, source: inputs.source, retryMode: 'manual', nextAttemptAt: now, lastManualAttemptAt: now, lastManualAttemptFingerprint: inputs.sourceFingerprint, manualAttemptTimestamps: [...recent, now], projectionFence: fence },
      }, { new: true });
      if (pending) result.acceptedCount++;
      else result.alreadyRunningCount++;
    }
    result.nextRetryAt = Number.isFinite(earliest) ? new Date(earliest).toISOString() : null;
    return result;
  }
}

export function createUserNoteTopicIndexService(store: TopicStore = new MongoTopicStore(), now: () => Date = () => new Date()) {
  return {
    async scheduleUserNoteTopicIndex(userId: string, noteId: string): Promise<void> {
      const note = await store.getNote(userId, noteId);
      if (!note) return;
      await store.schedule(userId, note, buildTopicInputs(note), now());
    },
    retryFailedUserTopics(userId: string, scope: TopicScope): Promise<RetryFailedResult> {
      return store.retryFailed(userId, scope, now());
    },
    store,
  };
}

export const { scheduleUserNoteTopicIndex, retryFailedUserTopics } = createUserNoteTopicIndexService();
export { randomUUID, LEASE_MS, TEN_MINUTES, DAY };

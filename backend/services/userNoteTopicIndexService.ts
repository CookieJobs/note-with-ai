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
  topicIndexFence?: number;
  topicIndexSuccess?: {
    sourceRevision: number;
    sourceFingerprint: string;
    topics: string[];
    source: TopicInputs['source'];
    indexedAt: Date;
  } | null;
  topicIndexScheduled?: { sourceRevision: number; sourceFingerprint: string } | null;
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

export interface UserTopicIndexDto {
  scope: TopicScope;
  timezone: 'Asia/Shanghai';
  rangeStart: string | null;
  rangeEnd: string | null;
  totalNotesInRange: number;
  readyNotesInRange: number;
  pendingNotesInRange: number;
  failedNotesInRange: number;
  lastErrorAt: string | null;
  topics: Array<{ topic: string; noteCount: number }>;
  staleSnapshot: {
    noteCount: number;
    indexedAt: string | null;
    topics: Array<{ topic: string; noteCount: number }>;
    label: '旧快照，不计入当前覆盖';
  } | null;
  indexStatus: 'empty' | 'building' | 'ready' | 'partial' | 'failed';
  updatedAt: string | null;
}

function assertTopicScope(scope: TopicScope): void {
  if (scope !== 'all' && scope !== 'year' && scope !== 'sixMonths') {
    throw new Error('话题范围无效');
  }
}

function noteProjection(note: any): TopicNote {
  return {
    _id: String(note._id), userId: String(note.userId), revision: note.revision,
    title: note.title, content: note.content, contentText: note.contentText,
    summary: note.summary, keywords: note.keywords, createdAt: note.createdAt,
    topicIndexFence: note.topicIndexFence,
    topicIndexSuccess: note.topicIndexSuccess,
    topicIndexScheduled: note.topicIndexScheduled,
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
  if (scope === 'all') return true;
  const start = topicScopeStartAt(scope, now);
  return noteDate >= start! && noteDate < topicScopeEndAt(now);
}

function addTopicCounts(counts: Map<string, number>, rawTopics: readonly string[] | undefined): void {
  const unique = new Set((rawTopics ?? []).map(normalizeTopicLabel).filter(Boolean));
  for (const topic of unique) counts.set(topic, (counts.get(topic) ?? 0) + 1);
}

function sortedTopicCounts(counts: Map<string, number>): Array<{ topic: string; noteCount: number }> {
  return [...counts].map(([topic, noteCount]) => ({ topic, noteCount }))
    .sort((left, right) => right.noteCount - left.noteCount || (left.topic < right.topic ? -1 : left.topic > right.topic ? 1 : 0));
}

function snapshotMatches(snapshot: any, inputs: TopicInputs): boolean {
  return snapshot?.sourceRevision === inputs.sourceRevision
    && snapshot?.sourceFingerprint === inputs.sourceFingerprint
    && Array.isArray(snapshot?.topics);
}

function laterIso(values: Array<Date | string | null | undefined>): string | null {
  const latest = values.reduce<number>((max, value) => {
    if (!value) return max;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? Math.max(max, timestamp) : max;
  }, -Infinity);
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

export async function getUserTopicIndex(userId: string, scope: TopicScope, now = new Date()): Promise<UserTopicIndexDto> {
  assertTopicScope(scope);
  const rangeStart = topicScopeStartAt(scope, now);
  const rangeEnd = scope === 'all' ? null : topicScopeEndAt(now);
  const filter: Record<string, unknown> = { userId };
  if (scope !== 'all') filter.createdAt = { $gte: rangeStart, $lt: rangeEnd };
  const notes: any[] = await Note.find(filter).select('+topicIndexSuccess').lean();
  const noteIds = notes.map((note) => note._id);
  const indexes: any[] = noteIds.length
    ? await UserNoteTopicIndex.find({ userId, noteId: { $in: noteIds } }).lean()
    : [];
  const indexByNote = new Map(indexes.map((index) => [String(index.noteId), index]));
  const currentTopics = new Map<string, number>();
  const staleTopics = new Map<string, number>();
  const staleSnapshots: any[] = [];
  let ready = 0;
  let pending = 0;
  let failed = 0;
  const failureTimes: Array<Date | string | null | undefined> = [];
  const successTimes: Array<Date | string | null | undefined> = [];

  for (const note of notes) {
    const inputs = buildTopicInputs(noteProjection(note));
    const index = indexByNote.get(String(note._id));
    const authoritativeSuccess = note.topicIndexSuccess;
    const projectionIsCurrent = index?.sourceRevision === inputs.sourceRevision
      && index?.sourceFingerprint === inputs.sourceFingerprint;
    const authoritativeIsCurrent = snapshotMatches(authoritativeSuccess, inputs);
    const indexedSnapshotIsCurrent = !authoritativeSuccess && projectionIsCurrent
      && index?.status === 'ready' && Array.isArray(index.topics);

    if (authoritativeIsCurrent) {
      ready++;
      addTopicCounts(currentTopics, authoritativeSuccess.topics);
      successTimes.push(authoritativeSuccess.indexedAt);
      continue;
    }
    if (indexedSnapshotIsCurrent) {
      ready++;
      addTopicCounts(currentTopics, index.topics);
      successTimes.push(index.indexedAt);
      continue;
    }

    const isFreshFailure = projectionIsCurrent && index?.status === 'failed';
    if (isFreshFailure) {
      failed++;
      failureTimes.push(index.errorAt);
    } else {
      pending++;
    }

    const stale = authoritativeSuccess ?? index?.lastSuccess;
    if (stale && !snapshotMatches(stale, inputs) && Array.isArray(stale.topics)) {
      staleSnapshots.push(stale);
      addTopicCounts(staleTopics, stale.topics);
    }
  }

  const total = notes.length;
  const indexStatus: UserTopicIndexDto['indexStatus'] = total === 0
    ? 'empty'
    : ready === total
      ? 'ready'
      : ready > 0 || (failed > 0 && pending > 0)
        ? 'partial'
        : failed === total
          ? 'failed'
          : 'building';
  const staleSnapshot = staleSnapshots.length ? {
    noteCount: staleSnapshots.length,
    indexedAt: laterIso(staleSnapshots.map((snapshot) => snapshot.indexedAt)),
    topics: sortedTopicCounts(staleTopics),
    label: '旧快照，不计入当前覆盖' as const,
  } : null;

  return {
    scope,
    timezone: 'Asia/Shanghai',
    rangeStart: rangeStart?.toISOString() ?? null,
    rangeEnd: rangeEnd?.toISOString() ?? null,
    totalNotesInRange: total,
    readyNotesInRange: ready,
    pendingNotesInRange: pending,
    failedNotesInRange: failed,
    lastErrorAt: laterIso(failureTimes),
    topics: sortedTopicCounts(currentTopics),
    staleSnapshot,
    indexStatus,
    updatedAt: laterIso(successTimes),
  };
}

export class MongoTopicStore implements TopicStore {
  async getNote(userId: string, noteId: string): Promise<TopicNote | null> {
    const note = await Note.findOne({ _id: noteId, userId })
      .select('+topicIndexFence +topicIndexSuccess +topicIndexScheduled')
      .lean();
    return note ? noteProjection(note) : null;
  }

  async getIndex(userId: string, noteId: string): Promise<any | null> {
    return UserNoteTopicIndex.findOne({ userId, noteId }).lean();
  }

  async recoverSuccessProjection(userId: string, noteId: string, now: Date): Promise<boolean> {
    const note = await this.getNote(userId, noteId);
    if (!note || !note.topicIndexSuccess || !note.topicIndexScheduled) return false;
    const inputs = buildTopicInputs(note);
    const success = note.topicIndexSuccess;
    if (
      success.sourceRevision !== inputs.sourceRevision
      || success.sourceFingerprint !== inputs.sourceFingerprint
      || note.topicIndexScheduled.sourceRevision !== inputs.sourceRevision
      || note.topicIndexScheduled.sourceFingerprint !== inputs.sourceFingerprint
      || typeof note.topicIndexFence !== 'number'
    ) return false;

    const fence = note.topicIndexFence;
    const snapshot = {
      sourceRevision: success.sourceRevision,
      sourceFingerprint: success.sourceFingerprint,
      topics: success.topics,
      source: success.source,
      indexedAt: success.indexedAt,
    };
    const current = await this.getIndex(userId, noteId);
    const sameTopics = (left: unknown, right: unknown) => Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((topic, index) => topic === right[index]);
    const sameDate = (left: unknown, right: unknown) => new Date(String(left)).getTime() === new Date(String(right)).getTime();
    const currentSuccess = current?.lastSuccess;
    if (
      current?.status === 'ready'
      && current.sourceRevision === inputs.sourceRevision
      && current.sourceFingerprint === inputs.sourceFingerprint
      && current.projectionFence === fence
      && current.source === success.source
      && sameTopics(current.topics, success.topics)
      && sameDate(current.indexedAt, success.indexedAt)
      && currentSuccess?.sourceRevision === success.sourceRevision
      && currentSuccess?.sourceFingerprint === success.sourceFingerprint
      && currentSuccess?.source === success.source
      && sameTopics(currentSuccess?.topics, success.topics)
      && sameDate(currentSuccess?.indexedAt, success.indexedAt)
    ) return true;

    const projectable = { $lte: [{ $ifNull: ['$projectionFence', 0] }, { $literal: fence }] };
    await UserNoteTopicIndex.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId), noteId: new mongoose.Types.ObjectId(noteId) },
      [{ $set: {
        sourceRevision: { $cond: [projectable, { $literal: inputs.sourceRevision }, '$sourceRevision'] },
        sourceFingerprint: { $cond: [projectable, { $literal: inputs.sourceFingerprint }, '$sourceFingerprint'] },
        status: { $cond: [projectable, 'ready', '$status'] },
        topics: { $cond: [projectable, { $literal: success.topics }, '$topics'] },
        source: { $cond: [projectable, { $literal: success.source }, '$source'] },
        indexedAt: { $cond: [projectable, { $literal: success.indexedAt }, '$indexedAt'] },
        errorAt: { $cond: [projectable, null, '$errorAt'] },
        lastErrorCode: { $cond: [projectable, null, '$lastErrorCode'] },
        retryMode: { $cond: [projectable, null, '$retryMode'] },
        nextAttemptAt: { $cond: [projectable, null, '$nextAttemptAt'] },
        claimToken: { $cond: [projectable, null, '$claimToken'] },
        leaseUntil: { $cond: [projectable, null, '$leaseUntil'] },
        lastSuccess: { $cond: [projectable, { $literal: snapshot }, '$lastSuccess'] },
        projectionFence: { $cond: [projectable, { $literal: fence }, { $ifNull: ['$projectionFence', 0] }] },
        createdAt: { $ifNull: ['$createdAt', { $literal: now }] },
        updatedAt: { $literal: now },
        userId: { $ifNull: ['$userId', { $literal: new mongoose.Types.ObjectId(userId) }] },
        noteId: { $ifNull: ['$noteId', { $literal: new mongoose.Types.ObjectId(noteId) }] },
      } }],
      { upsert: true, new: true },
    );
    const projected = await this.getIndex(userId, noteId);
    return projected?.projectionFence === fence && projected?.status === 'ready';
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
    const stuckPending = { $and: [
      { $eq: ['$status', 'pending'] },
      { $eq: [{ $ifNull: ['$nextAttemptAt', null] }, null] },
    ] };
    const canProject = { $lt: [{ $ifNull: ['$projectionFence', 0] }, { $literal: fence }] };
    await UserNoteTopicIndex.findOneAndUpdate(
      { userId: uid, noteId: id },
      [{ $set: {
        userId: { $ifNull: ['$userId', { $literal: uid }] }, noteId: { $ifNull: ['$noteId', { $literal: id }] },
        sourceRevision: { $cond: [canProject, { $literal: inputs.sourceRevision }, '$sourceRevision'] },
        sourceFingerprint: { $cond: [canProject, { $literal: inputs.sourceFingerprint }, '$sourceFingerprint'] },
        status: { $cond: [canProject, { $cond: [
          samePair,
          { $cond: [
            { $and: [stuckPending, { $gte: [{ $ifNull: ['$automaticAttemptCount', 0] }, 3] }] },
            'failed',
            { $ifNull: ['$status', 'pending'] },
          ] },
          'pending',
        ] }, '$status'] },
        topics: { $cond: [canProject, { $cond: [samePair, { $ifNull: ['$topics', []] }, { $literal: [] }] }, '$topics'] },
        source: { $cond: [canProject, { $literal: inputs.source }, '$source'] },
        automaticAttemptCount: { $cond: [canProject, { $cond: [{ $eq: ['$automaticAttemptFingerprint', { $literal: inputs.sourceFingerprint }] }, { $ifNull: ['$automaticAttemptCount', 0] }, 0] }, '$automaticAttemptCount'] },
        automaticAttemptFingerprint: { $cond: [canProject, { $literal: inputs.sourceFingerprint }, '$automaticAttemptFingerprint'] },
        nextAttemptAt: { $cond: [canProject, { $cond: [samePair, { $cond: [
          stuckPending,
          { $cond: [{ $gte: [{ $ifNull: ['$automaticAttemptCount', 0] }, 3] }, null, { $literal: now }] },
          '$nextAttemptAt',
        ] }, { $literal: now }] }, '$nextAttemptAt'] },
        scheduledAt: { $cond: [canProject, { $literal: now }, '$scheduledAt'] }, updatedAt: { $literal: now }, createdAt: { $ifNull: ['$createdAt', { $literal: now }] },
        projectionFence: { $cond: [canProject, { $literal: fence }, { $ifNull: ['$projectionFence', 0] }] },
        manualAttemptTimestamps: { $ifNull: ['$manualAttemptTimestamps', []] },
        retryMode: { $cond: [canProject, { $cond: [samePair, { $ifNull: ['$retryMode', null] }, null] }, '$retryMode'] },
        claimToken: { $cond: [canProject, { $cond: [samePair, { $cond: [stuckPending, null, { $ifNull: ['$claimToken', null] }] }, null] }, '$claimToken'] },
        leaseUntil: { $cond: [canProject, { $cond: [samePair, { $cond: [stuckPending, null, { $ifNull: ['$leaseUntil', null] }] }, null] }, '$leaseUntil'] },
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
      await UserNoteTopicIndex.deleteOne({ _id: index._id, claimToken: token, status: 'processing' });
      return null;
    }
    const inputs = buildTopicInputs(note);
    if (inputs.sourceRevision !== index.sourceRevision || inputs.sourceFingerprint !== index.sourceFingerprint) {
      await this.schedule(userId, note, inputs, now);
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
    if (!note) {
      await UserNoteTopicIndex.deleteOne({ userId: job.userId, noteId: job.noteId, claimToken: job.claimToken, status: 'processing' });
      return false;
    }
    const inputs = buildTopicInputs(note);
    if (inputs.sourceRevision !== job.sourceRevision || inputs.sourceFingerprint !== job.sourceFingerprint) {
      await this.schedule(job.userId, note, inputs, now);
      return false;
    }
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
    if (!note) {
      await UserNoteTopicIndex.deleteOne({ userId: job.userId, noteId: job.noteId, claimToken: job.claimToken, status: 'processing' });
      return;
    }
    const inputs = buildTopicInputs(note);
    if (inputs.sourceRevision !== job.sourceRevision || inputs.sourceFingerprint !== job.sourceFingerprint) {
      await this.schedule(job.userId, note, inputs, now);
      return;
    }
    const owned = await Note.updateOne({ ...sourceFilter(note, inputs), topicIndexClaimToken: job.claimToken, topicIndexClaimVersion: job.claimVersion, topicIndexClaimUntil: { $gt: now } }, { $set: { topicIndexClaimToken: null, topicIndexClaimUntil: null } }, { timestamps: false });
    if (owned.matchedCount !== 1) return;
    await UserNoteTopicIndex.updateOne({ userId: job.userId, noteId: job.noteId, sourceRevision: job.sourceRevision, sourceFingerprint: job.sourceFingerprint, status: 'processing', claimToken: job.claimToken }, {
      $set: { status: exhausted ? 'failed' : 'pending', errorAt: now, lastErrorCode: errorCode, retryMode: job.mode, nextAttemptAt: exhausted || job.mode === 'manual' ? null : new Date(now.getTime() + delay), claimToken: null, leaseUntil: null },
    });
  }

  async retryFailed(userId: string, scope: TopicScope, now: Date): Promise<RetryFailedResult> {
    assertTopicScope(scope);
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
    getUserTopicIndex(userId: string, scope: TopicScope): Promise<UserTopicIndexDto> {
      return getUserTopicIndex(userId, scope, now());
    },
    store,
  };
}

export const { scheduleUserNoteTopicIndex, retryFailedUserTopics } = createUserNoteTopicIndexService();
export { randomUUID, LEASE_MS, TEN_MINUTES, DAY };

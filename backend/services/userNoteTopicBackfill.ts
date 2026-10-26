import mongoose from 'mongoose';
import { Note } from '../models/Note';
import UserNoteTopicBackfill from '../models/UserNoteTopicBackfill';
import UserNoteTopicIndex from '../models/UserNoteTopicIndex';
import { MongoTopicStore } from './userNoteTopicIndexService';
import { buildTopicInputs } from './userNoteTopicInputs';

const MAX_PAGE_SIZE = 100;

export type TopicBackfillPage = { scanned: number; cursor: string | null; done: boolean };

export interface TopicBackfillDependencies {
  store: Pick<MongoTopicStore, 'getNote' | 'getIndex' | 'recoverSuccessProjection' | 'schedule'>;
  now: () => Date;
}

const defaultDependencies: TopicBackfillDependencies = {
  store: new MongoTopicStore(),
  now: () => new Date(),
};

function idString(value: unknown): string | null {
  return value ? String(value) : null;
}

async function ensureCheckpoint(userId: string): Promise<any> {
  return UserNoteTopicBackfill.findOneAndUpdate(
    { scopeKey: `user:${userId}` },
    { $setOnInsert: { scopeKey: `user:${userId}`, userId: new mongoose.Types.ObjectId(userId), cursor: null, done: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function runTopicBackfillPage(
  { userId, limit, rescanIntervalMs = 0 }: { userId: string; limit: number; rescanIntervalMs?: number },
  dependencies: TopicBackfillDependencies = defaultDependencies,
): Promise<TopicBackfillPage> {
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || 1));
  const checkpoint = await ensureCheckpoint(userId);
  const now = dependencies.now();
  if (rescanIntervalMs > 0 && checkpoint.done && checkpoint.nextRescanAt && new Date(checkpoint.nextRescanAt).getTime() > now.getTime()) {
    return { scanned: 0, cursor: null, done: true };
  }
  // A completed sweep is restarted from the beginning on its next bounded pass. This
  // catches a missed hook without requiring a GET request or a full-table sync.
  const previousCursor = checkpoint.done ? null : idString(checkpoint.cursor);
  const checkpointFilter = {
    _id: checkpoint._id,
    cursor: checkpoint.cursor ?? null,
    done: Boolean(checkpoint.done),
    cursorVersion: Number(checkpoint.cursorVersion ?? 0),
  };
  const filter: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(userId) };
  if (previousCursor) filter._id = { $gt: new mongoose.Types.ObjectId(previousCursor) };
  const notes = await Note.find(filter).sort({ _id: 1 }).limit(pageSize).select('_id').lean();
  for (const entry of notes) {
    const noteId = String(entry._id);
    const note = await dependencies.store.getNote(userId, noteId);
    if (!note) continue;
    const inputs = buildTopicInputs(note);

    // Note.topicIndexSuccess is the standalone-safe authority. Restore its exact
    // snapshot before considering any work that could invoke the model.
    if (await dependencies.store.recoverSuccessProjection(userId, noteId, now)) continue;

    const row = await dependencies.store.getIndex(userId, noteId);
    const sameInput = row?.sourceRevision === inputs.sourceRevision && row?.sourceFingerprint === inputs.sourceFingerprint;
    if (sameInput) {
      if (row.status === 'ready' || row.status === 'failed') continue;
      if (row.status === 'processing' && row.leaseUntil && new Date(row.leaseUntil).getTime() > now.getTime()) continue;
      if (row.status === 'pending' && row.nextAttemptAt && new Date(row.nextAttemptAt).getTime() > 0) continue;
    }
    await dependencies.store.schedule(userId, note, inputs, now);
  }

  const finished = notes.length < pageSize;
  const nextCursor = finished ? null : String(notes[notes.length - 1]._id);
  const advanced = await UserNoteTopicBackfill.updateOne(
    checkpointFilter,
    {
      $set: {
        cursor: nextCursor ? new mongoose.Types.ObjectId(nextCursor) : null,
        done: finished,
        nextRescanAt: finished && rescanIntervalMs > 0 ? new Date(now.getTime() + rescanIntervalMs) : null,
        updatedAt: now,
      },
      $inc: { cursorVersion: 1 },
    },
  );
  if (advanced.matchedCount !== 1) {
    const current: any = await UserNoteTopicBackfill.findById(checkpoint._id).lean();
    return { scanned: notes.length, cursor: idString(current?.cursor), done: Boolean(current?.done) };
  }
  return { scanned: notes.length, cursor: nextCursor, done: finished };
}

export async function getTopicBackfillUsersPage(cursor: string | null, limit: number): Promise<{ userIds: string[]; cursor: string | null }> {
  const filter = cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {};
  const users = await (await import('../models/User')).default.find(filter).sort({ _id: 1 }).limit(limit).select('_id').lean();
  return {
    userIds: users.map((user: any) => String(user._id)),
    cursor: users.length === limit ? String(users[users.length - 1]._id) : null,
  };
}

export async function getRuntimeCursor(): Promise<any> {
  return UserNoteTopicBackfill.findOneAndUpdate(
    { scopeKey: '__runtime__' },
    { $setOnInsert: { scopeKey: '__runtime__', userId: null, cursor: null, done: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function advanceRuntimeCursor(current: any, nextCursor: string | null, now: Date): Promise<string | null> {
  const matched = await UserNoteTopicBackfill.updateOne(
    { _id: current._id, cursor: current.cursor ?? null, cursorVersion: Number(current.cursorVersion ?? 0) },
    { $set: { cursor: nextCursor ? new mongoose.Types.ObjectId(nextCursor) : null, updatedAt: now }, $inc: { cursorVersion: 1 } },
  );
  if (matched.matchedCount === 1) return nextCursor;
  const latest: any = await UserNoteTopicBackfill.findById(current._id).lean();
  return idString(latest?.cursor);
}

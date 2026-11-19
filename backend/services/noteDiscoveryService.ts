import { createHash } from 'node:crypto';
import { isObjectIdOrHexString, Types } from 'mongoose';
import NoteDiscovery from '../models/NoteDiscovery';
import NoteDiscoveryPreference from '../models/NoteDiscoveryPreference';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import type { DiscoveryCandidate, DiscoveryQualityResult, DiscoveryRunUsage, EvidenceInput } from '../types/noteDiscovery';
import logger from '../utils/logger';
import {
  DiscoverySourceError, resolveDiscoveryEvidence, type DiscoverySource, type ValidatedEvidence,
} from './noteDiscoveryEvidenceService';
import { discoveryCandidateSchema, type SubmittedDiscoveryCandidate } from './noteDiscoveryTools';
import { noteDiscoveryWorkerStore, type ClaimedDiscoveryRun } from './noteDiscoveryWorkerStore';

const writeConcern = { w: 'majority', j: true } as const;

function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function discoverySourceFingerprint(evidence: readonly EvidenceInput[]): string {
  return digest([...new Set(evidence.map(({ noteId, revision }) => `${noteId.toLowerCase()}:${revision}`))].sort());
}

export function discoveryObservationFingerprint(candidate: Pick<DiscoveryCandidate, 'kind' | 'observation'>): string {
  return digest([candidate.kind, normalizeText(candidate.observation)]);
}

function proposalTextIsConcrete(text: string): boolean {
  const normalized = normalizeText(text);
  return [...normalized].length >= 6
    && !/^(?:ignore|disregard|forget)\s+(?:all\s+|the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions|prompts?|messages?)/iu.test(text)
    && !/^(?:忽略|无视|忘记)(?:所有|前面|之前|以上|系统|先前)+(?:的)?(?:指令|提示|约束)/u.test(text)
    && !/^(?:nothingnew|notapplicable|nocounterevidence|nothingtomention|unknown|暂无更多信息|未发现反例|没有反例|不适用|无法判断)$/u.test(normalized);
}

export async function validateCandidate(
  value: DiscoveryCandidate, evidence: readonly ValidatedEvidence[], readSources: readonly DiscoverySource[] = [],
): Promise<DiscoveryQualityResult> {
  const candidate = discoveryCandidateSchema.safeParse(value);
  const fail = (reason: string): DiscoveryQualityResult => ({ passed: false, reason });
  if (!candidate.success) return fail('invalid_candidate');
  const { kind, observation, whyNow, qualification, suggestedAction, draft, relationshipKey, questionKey, rationale } = candidate.data;
  if (evidence.length !== candidate.data.evidence.length || !candidate.data.evidence.every((item, index) => {
    const actual = evidence[index];
    return actual.noteId === item.noteId.toLowerCase() && actual.revision === item.revision && actual.excerpt === item.excerpt
      && Number.isSafeInteger(actual.locator?.start) && actual.locator.start >= 0
      && actual.locator.end - actual.locator.start === item.excerpt.length
      && Number.isFinite(Date.parse(actual.noteDate));
  })) return fail('unverified_evidence');

  const excerpts = evidence.map(item => normalizeText(item.excerpt));
  const fields = [observation, whyNow, qualification, suggestedAction, rationale.novelInsight, rationale.counterEvidence];
  if (fields.some(field => !proposalTextIsConcrete(field) || excerpts.some(excerpt => excerpt.includes(normalizeText(field))))) {
    return fail('insufficient_increment');
  }
  const [seenObservation, seenWhyNow, seenQualification, seenAction, seenNovelty, seenCounter] = fields.map(normalizeText);
  if (seenObservation === seenWhyNow || seenObservation === seenAction || seenNovelty === seenCounter || seenQualification === seenAction) {
    return fail('insufficient_increment');
  }

  if (kind === 'connection' || kind === 'follow_up') {
    const uniqueSources = [...new Map(evidence.map(item => [item.noteId, item])).values()];
    if (uniqueSources.length < 2 || new Set(excerpts).size < 2) return fail('independent_sources_required');
    if (readSources.length) {
      const sourceTexts = new Set(uniqueSources.map(item => readSources.find(source =>
        source.noteId === item.noteId && source.revision === item.revision)?.contentText).filter((text): text is string => !!text).map(normalizeText));
      if (sourceTexts.size < 2) return fail('independent_sources_required');
    }
    if (kind === 'connection' && !relationshipKey) return fail('relationship_required');
    if (kind === 'follow_up' && (!questionKey || evidence.some((item, index) =>
      index > 0 && Date.parse(item.noteDate) < Date.parse(evidence[index - 1].noteDate))
      || Date.parse(evidence[0].noteDate) >= Date.parse(evidence[evidence.length - 1].noteDate)
      || evidence[0].noteId === evidence[evidence.length - 1].noteId)) return fail('ordered_follow_up_required');
  }
  if (kind === 'next_step' && (!draft || !proposalTextIsConcrete(draft) || !rationale.missingInformation.length
    || !rationale.missingInformation.every(proposalTextIsConcrete))) return fail('draft_and_open_questions_required');

  return { passed: true, rationale };
}

type DiscoveryIdentity = {
  userId: string | Types.ObjectId;
  runId: string | Types.ObjectId;
  generation: number;
};

export async function isPublishedDiscovery(userId: string, discovery: DiscoveryIdentity): Promise<boolean> {
  if (!isObjectIdOrHexString(userId) || !isObjectIdOrHexString(discovery.runId)
    || String(discovery.userId) !== userId.toLowerCase() || !Number.isSafeInteger(discovery.generation) || discovery.generation < 1) return false;
  return !!await NoteDiscoveryRun.exists({
    _id: discovery.runId, userId, generation: discovery.generation, status: 'completed',
  }).maxTimeMS(2000);
}

type SavedEvidence = Omit<EvidenceInput, 'noteId'> & { noteId: string | Types.ObjectId };

async function currentEvidence(userId: string, evidence: readonly SavedEvidence[]) {
  try {
    return await resolveDiscoveryEvidence(userId, evidence.map(({ noteId, revision, excerpt }) => ({ noteId: String(noteId), revision, excerpt })));
  } catch (error) {
    if (error instanceof DiscoverySourceError && error.code !== 'read_failed') return null;
    throw error;
  }
}

export async function hasCurrentDiscoveryEvidence(userId: string, evidence: readonly SavedEvidence[]): Promise<boolean> {
  return !!await currentEvidence(userId, evidence);
}

export async function canUseDiscovery(
  userId: string, discovery: DiscoveryIdentity & { evidence: readonly SavedEvidence[] },
): Promise<boolean> {
  return await isPublishedDiscovery(userId, discovery) && await hasCurrentDiscoveryEvidence(userId, discovery.evidence);
}

export async function invalidateDiscoverySource(userId: string, noteId: string, nextRevision?: number): Promise<void> {
  if (!isObjectIdOrHexString(userId) || !isObjectIdOrHexString(noteId)) return;
  await NoteDiscovery.updateMany({
    userId, status: 'ready',
    evidence: { $elemMatch: { noteId, ...(nextRevision === undefined ? {} : { revision: { $lt: nextRevision } }) } },
  }, { $set: { status: 'stale' } }).maxTimeMS(2000);
}

export async function invalidateDiscoverySourceBestEffort(userId: string, noteId: string, nextRevision?: number): Promise<void> {
  try { await invalidateDiscoverySource(userId, noteId, nextRevision); }
  catch { logger.warn('Note discovery source invalidation failed', { code: 'DISCOVERY_INVALIDATE_SOURCE_FAILED' }); }
}

type PublicationOutcome = 'completed' | 'no_result' | 'cancelled';
type PublicationStore = Pick<typeof noteDiscoveryWorkerStore, 'isCurrentFence' | 'finish'>;

function sourceKey(ids: (Types.ObjectId | string)[]): string {
  return [...new Set(ids.map(String))].sort().join(',');
}

function sourceBodyBaselines(sources: readonly DiscoverySource[]) {
  return sources.map(({ noteId, contentText }) => ({
    noteId, fingerprint: digest(contentText.normalize('NFKC').replace(/\[(?:图片|image)\]|\s+/giu, '')),
  }));
}

/** Stage by generation first. Only a matching completed run makes a staged row visible. */
export async function publishDiscoveryRun(
  run: ClaimedDiscoveryRun, submissions: readonly SubmittedDiscoveryCandidate[], usage: DiscoveryRunUsage,
  canContinue: () => Promise<boolean>, store: PublicationStore = noteDiscoveryWorkerStore,
  readSources: readonly DiscoverySource[] = [], publicationDeadline?: Date,
): Promise<PublicationOutcome> {
  const userId = run.userId.toHexString();
  const runId = run._id.toHexString();
  const fence = { userId, runId, leaseToken: run.leaseToken, generation: run.generation };
  const permitted = async () => await store.isCurrentFence(fence) && await canContinue();
  if (!submissions.length) return 'no_result';
  if (!await permitted()) return 'cancelled';
  await NoteDiscovery.init();
  const pref = await NoteDiscoveryPreference.findOne({ userId }, { feedback: 1 }).maxTimeMS(2000).lean();
  const checkedAt = new Date();
  const feedback = pref?.feedback.filter(item => !item.revokedAt && (!item.expiresAt || item.expiresAt > checkedAt)) ?? [];
  const staged = new Map<string, ValidatedEvidence[]>();
  for (const { candidate, evidence } of submissions) {
    if (staged.size === 3) break;
    if (!await permitted()) return 'cancelled';
    const current = await currentEvidence(userId, candidate.evidence);
    if (!current) continue;
    const quality = await validateCandidate(candidate, evidence, readSources.length ? readSources : current.sources);
    if (!quality.passed) continue;
    const sourceFingerprint = discoverySourceFingerprint(current.evidence);
    const bodyBaselines = sourceBodyBaselines(current.sources);
    const bodyById = new Map(bodyBaselines.map(item => [item.noteId, item.fingerprint]));
    const observationFingerprint = discoveryObservationFingerprint(candidate);
    if (staged.has(observationFingerprint)) continue;

    const ids = sourceKey(current.evidence.map(item => item.noteId));
    const suppressed = feedback.some(item => {
      if (item.kind === 'not_interested') return sourceKey(item.sourceIds) === ids && item.observationFingerprint === observationFingerprint;
      if (item.kind === 'not_related') {
        if (!candidate.relationshipKey || item.relationshipKey !== candidate.relationshipKey) return false;
        // Replacing a title, formatting or an entire source does not establish changed text in an original source.
        return !item.sourceBodyBaselines?.some((baseline) => {
          const body = bodyById.get(String(baseline.noteId));
          return body !== undefined && body !== baseline.fingerprint;
        });
      }
      return !!candidate.questionKey && item.questionKey === candidate.questionKey;
    });
    if (suppressed) continue;

    const previous = await NoteDiscovery.find({
      userId, sourceFingerprint, observationFingerprint, runId: { $ne: run._id },
    }, { runId: 1, generation: 1, userId: 1 }).maxTimeMS(2000).lean();
    let duplicate = false;
    for (const record of previous) {
      if (await isPublishedDiscovery(userId, record)) { duplicate = true; break; }
    }
    if (duplicate) continue;

    if (!await permitted()) return 'cancelled';
    const { rationale: _rationale, evidence: _evidence, ...proposal } = candidate;
    const key = { userId, runId, generation: run.generation, observationFingerprint };
    const now = new Date();
    try {
      await NoteDiscovery.updateOne(key, {
        $setOnInsert: {
          ...key, ...proposal, sourceFingerprint, sourceBodyBaselines: bodyBaselines,
          quality, status: 'ready', createdAt: now, updatedAt: now,
          evidence: current.evidence.map(item => ({ ...item, noteDate: new Date(item.noteDate) })),
        },
      }, { upsert: true, timestamps: false, runValidators: true, setDefaultsOnInsert: true, writeConcern }).maxTimeMS(2000);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 11000 || !await NoteDiscovery.exists(key)) throw error;
    }
    staged.set(observationFingerprint, current.evidence);
  }
  if (!staged.size) return 'no_result';

  // The note hooks can run before a candidate insert. Recheck here and at read time
  // to cover an edit/delete between collections, including edits after this check.
  if (!await permitted()) return 'cancelled';
  const stored = await NoteDiscovery.find({ userId, runId, generation: run.generation, status: 'ready' }).maxTimeMS(2000).lean();
  if (stored.length !== staged.size) return 'no_result';
  for (const record of stored) {
    if (!staged.has(record.observationFingerprint) || !await hasCurrentDiscoveryEvidence(userId, record.evidence)) return 'no_result';
  }
  if (!await permitted()) return 'cancelled';
  return await store.finish(runId, run.leaseToken, 'completed', { usage, publicationDeadline }) ? 'completed' : 'cancelled';
}

/** Only clean rows that can no longer be made visible by any completing worker. */
export async function cleanUnpublishedDiscoveries(): Promise<number> {
  const rows = await NoteDiscovery.aggregate<{ _id: Types.ObjectId }>([
    { $lookup: { from: NoteDiscoveryRun.collection.name, localField: 'runId', foreignField: '_id', as: 'ownerRun' } },
    { $set: { ownerRun: { $arrayElemAt: ['$ownerRun', 0] } } },
    { $match: { $expr: { $or: [
      { $eq: [{ $ifNull: ['$ownerRun', null] }, null] },
      { $ne: ['$ownerRun.userId', '$userId'] },
      { $gt: ['$ownerRun.generation', '$generation'] },
      { $in: ['$ownerRun.status', ['failed', 'cancelled', 'no_result']] },
    ] } } },
    { $limit: 100 }, { $project: { _id: 1 } },
  ]).option({ maxTimeMS: 2000 });
  if (!rows.length) return 0;
  return (await NoteDiscovery.deleteMany({ _id: { $in: rows.map(row => row._id) } }).maxTimeMS(2000)).deletedCount;
}

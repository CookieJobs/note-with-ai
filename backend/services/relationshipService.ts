import { Note } from '../models/Note';
import { RelationshipFeedback } from '../models/RelationshipFeedback';
import { getDeepSeekClient } from './llmService';
import { logger } from '../utils/logger';

export type RelationshipKind =
  | 'continuation'
  | 'contrast'
  | 'change'
  | 'tension'
  | 'shared_origin';

export type ConfidenceBand = 'possible' | 'supported';

export type NoteEvidence = {
  noteId: string;
  revision: number;
  excerpt: string;
  occurredAt: string;
};

export type NoteRelationship = {
  relationshipId: string;
  source: NoteEvidence;
  candidate: NoteEvidence;
  kind: RelationshipKind;
  headline: string;
  explanation: string;
  confidence: ConfidenceBand;
  generatedAt: string;
};

export type RelationshipNote = {
  _id: unknown;
  revision?: unknown;
  title?: unknown;
  content?: unknown;
  contentText?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type RelationshipExplanation = {
  kind: RelationshipKind;
  headline: string;
  explanation: string;
  confidence: ConfidenceBand;
  sourceExcerpt: string;
  candidateExcerpt: string;
};

export type RelationshipFeedbackVerdict = 'helpful' | 'not_relevant' | 'hide_pair';

export type RelationshipContext = {
  relationship: NoteRelationship;
  notes: Array<{ noteId: string; title: string; occurredAt: string; excerpt: string }>;
};

const RELATIONSHIP_KINDS = new Set<RelationshipKind>([
  'continuation',
  'contrast',
  'change',
  'tension',
  'shared_origin',
]);

const CONFIDENCE_BANDS = new Set<ConfidenceBand>(['possible', 'supported']);

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function revisionValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function noteId(note: RelationshipNote): string {
  return String(note?._id || '');
}

function noteText(note: RelationshipNote): string {
  return stringValue(note.contentText) || stringValue(note.content);
}

function isoDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function oneSentence(value: unknown, maxLength: number): string {
  return stringValue(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[!?！？]+/g, '。')
    .slice(0, maxLength);
}

function containsExcerpt(text: string, excerpt: string): boolean {
  const candidate = stringValue(excerpt);
  return candidate.length > 0 && text.includes(candidate);
}

export function normalizePair(noteA: string, noteB: string): [string, string] {
  return [String(noteA), String(noteB)].sort((a, b) => a.localeCompare(b)) as [string, string];
}

export function relationshipIdFor(source: RelationshipNote, candidate: RelationshipNote): string {
  return `relationship:${noteId(source)}:${revisionValue(source.revision)}:${noteId(candidate)}:${revisionValue(candidate.revision)}`;
}

export function buildVerifiedRelationship(params: {
  source: RelationshipNote;
  candidate: RelationshipNote;
  explanation: RelationshipExplanation;
  generatedAt?: string;
}): NoteRelationship | null {
  const { source, candidate, explanation } = params;
  const sourceId = noteId(source);
  const candidateId = noteId(candidate);
  const sourceRevision = revisionValue(source.revision);
  const candidateRevision = revisionValue(candidate.revision);
  const sourceText = noteText(source);
  const candidateText = noteText(candidate);

  if (!sourceId || !candidateId || sourceId === candidateId || !sourceRevision || !candidateRevision) return null;
  if (!RELATIONSHIP_KINDS.has(explanation.kind) || !CONFIDENCE_BANDS.has(explanation.confidence)) return null;
  if (!containsExcerpt(sourceText, explanation.sourceExcerpt) || !containsExcerpt(candidateText, explanation.candidateExcerpt)) {
    return null;
  }

  const headline = oneSentence(explanation.headline, 40);
  const explanationText = oneSentence(explanation.explanation, 240);
  const sourceOccurredAt = isoDate(source.createdAt || source.updatedAt);
  const candidateOccurredAt = isoDate(candidate.createdAt || candidate.updatedAt);
  if (!headline || !explanationText || !sourceOccurredAt || !candidateOccurredAt) return null;

  return {
    relationshipId: relationshipIdFor(source, candidate),
    source: { noteId: sourceId, revision: sourceRevision, excerpt: stringValue(explanation.sourceExcerpt), occurredAt: sourceOccurredAt },
    candidate: { noteId: candidateId, revision: candidateRevision, excerpt: stringValue(explanation.candidateExcerpt), occurredAt: candidateOccurredAt },
    kind: explanation.kind,
    headline,
    explanation: explanationText,
    confidence: explanation.confidence,
    generatedAt: params.generatedAt || new Date().toISOString(),
  };
}

export async function generateRelationshipExplanation(params: {
  source: RelationshipNote;
  candidate: RelationshipNote;
  rerankReason?: string;
  rerankType?: string;
}): Promise<RelationshipExplanation | null> {
  const sourceText = noteText(params.source).slice(0, 2400);
  const candidateText = noteText(params.candidate).slice(0, 2400);
  if (!sourceText || !candidateText) return null;

  try {
    const client = getDeepSeekClient();
    const text = await client.chatCompletion([
      {
        role: 'system',
        content: '你是私人笔记关系解释器。只能根据提供的两段原文回答，不能补充外部事实。输出 JSON，不要输出 markdown。关系 kind 只能是 continuation、contrast、change、tension、shared_origin；confidence 只能是 possible 或 supported。两个 excerpt 必须逐字复制自对应原文，headline 不超过40个中文字符，explanation 必须同时解释两段原文。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          source: { id: noteId(params.source), revision: revisionValue(params.source.revision), text: sourceText },
          candidate: { id: noteId(params.candidate), revision: revisionValue(params.candidate.revision), text: candidateText },
          priorReason: oneSentence(params.rerankReason, 120),
          priorType: oneSentence(params.rerankType, 40),
          output: { kind: 'continuation', headline: '...', explanation: '...', confidence: 'possible', sourceExcerpt: '...', candidateExcerpt: '...' },
        }),
      },
    ], { max_tokens: 500, temperature: 0.1, response_format: { type: 'json_object' } });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!RELATIONSHIP_KINDS.has(parsed.kind as RelationshipKind) || !CONFIDENCE_BANDS.has(parsed.confidence as ConfidenceBand)) return null;
    return {
      kind: parsed.kind as RelationshipKind,
      headline: oneSentence(parsed.headline, 40),
      explanation: oneSentence(parsed.explanation, 240),
      confidence: parsed.confidence as ConfidenceBand,
      sourceExcerpt: stringValue(parsed.sourceExcerpt),
      candidateExcerpt: stringValue(parsed.candidateExcerpt),
    };
  } catch {
    return null;
  }
}

export async function buildRelationshipFromCandidate(params: {
  source: RelationshipNote;
  candidate: RelationshipNote;
  rerankReason?: string;
  rerankType?: string;
}): Promise<NoteRelationship | null> {
  const explanation = await generateRelationshipExplanation(params);
  return explanation ? buildVerifiedRelationship({ ...params, explanation }) : null;
}

function feedbackPair(value: unknown): [string, string] | null {
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'string' || !item)) return null;
  return normalizePair(value[0], value[1]);
}

export async function filterVisibleRelationships<T extends Pick<NoteRelationship, 'relationshipId' | 'source' | 'candidate'>>(
  userId: string,
  relationships: T[],
): Promise<T[]> {
  if (relationships.length === 0) return [];
  const feedback = await RelationshipFeedback.find({ userId, verdict: { $in: ['hide_pair', 'not_relevant'] } }).lean();
  const hiddenPairs = new Set(
    (feedback as Array<{ noteIds?: unknown; verdict?: unknown }>)
      .filter((item) => item.verdict === 'hide_pair')
      .map((item) => feedbackPair(item.noteIds))
      .filter((pair): pair is [string, string] => pair !== null)
      .map((pair) => pair.join(':')),
  );
  const dismissedRelationships = new Set(
    (feedback as Array<{ relationshipId?: unknown; verdict?: unknown }>)
      .filter((item) => item.verdict === 'not_relevant' && typeof item.relationshipId === 'string')
      .map((item) => item.relationshipId as string),
  );
  return relationships.filter((relationship) => {
    const pair = normalizePair(relationship.source.noteId, relationship.candidate.noteId);
    return !hiddenPairs.has(pair.join(':')) && !dismissedRelationships.has(relationship.relationshipId);
  });
}

export async function submitRelationshipFeedback(input: {
  userId: string;
  relationshipId: string;
  sourceNoteId: string;
  candidateNoteId: string;
  sourceRevision: number;
  candidateRevision: number;
  verdict: RelationshipFeedbackVerdict;
}) {
  if (!input.relationshipId || !input.sourceNoteId || !input.candidateNoteId || input.sourceNoteId === input.candidateNoteId ||
    !Number.isInteger(input.sourceRevision) || input.sourceRevision < 1 || !Number.isInteger(input.candidateRevision) || input.candidateRevision < 1 ||
    !['helpful', 'not_relevant', 'hide_pair'].includes(input.verdict)) {
    throw new Error('关系反馈参数无效');
  }
  const [source, candidate] = await Promise.all([
    Note.findOne({ _id: input.sourceNoteId, userId: input.userId }).select('_id revision'),
    Note.findOne({ _id: input.candidateNoteId, userId: input.userId }).select('_id revision'),
  ]);
  if (!source || !candidate) throw new Error('关系不存在或无权限');
  if (revisionValue(source.revision) !== input.sourceRevision || revisionValue(candidate.revision) !== input.candidateRevision) {
    throw new Error('关系已更新，请刷新后重试');
  }
  if (relationshipIdFor(source as RelationshipNote, candidate as RelationshipNote) !== input.relationshipId) {
    throw new Error('关系不存在或无权限');
  }
  const noteIds = normalizePair(input.sourceNoteId, input.candidateNoteId);
  try {
    const result = await RelationshipFeedback.findOneAndUpdate(
      { userId: input.userId, relationshipId: input.relationshipId },
      { $set: { ...input, noteIds } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    logger.info('relationship_feedback_submitted', {
      userId: input.userId,
      relationshipId: input.relationshipId,
      sourceNoteId: input.sourceNoteId,
      candidateNoteId: input.candidateNoteId,
      verdict: input.verdict,
    });
    return result;
  } catch (error) {
    logger.warn('relationship_feedback_failed', {
      userId: input.userId,
      relationshipId: input.relationshipId,
      errorCode: error instanceof Error ? error.name : 'UNKNOWN',
    });
    throw error;
  }
}

export async function findRelationshipContext(userId: string, requestedRelationshipId: string): Promise<RelationshipContext | null> {
  if (!requestedRelationshipId) return null;
  const notes = await Note.find({ userId }).select('_id title content contentText revision createdAt updatedAt recommendCache').lean();
  for (const note of notes as unknown as RelationshipNote[]) {
    const cache = (note as RelationshipNote & { recommendCache?: unknown }).recommendCache;
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) continue;
    const byCandidateId = (cache as { byCandidateId?: unknown }).byCandidateId;
    if (!byCandidateId || typeof byCandidateId !== 'object' || Array.isArray(byCandidateId)) continue;
    for (const entry of Object.values(byCandidateId as Record<string, unknown>)) {
      const relationship = (entry as { relationship?: unknown })?.relationship;
      if (!relationship || typeof relationship !== 'object' || (relationship as NoteRelationship).relationshipId !== requestedRelationshipId) continue;
      const candidate = relationship as NoteRelationship;
      const currentIds = [candidate.source.noteId, candidate.candidate.noteId];
      const currentNotes = (notes as unknown as RelationshipNote[]).filter((item) => currentIds.includes(noteId(item)));
      if (currentNotes.length !== 2 || !currentNotes.every((item) => revisionValue(item.revision) === (currentIds[0] === noteId(item) ? candidate.source.revision : candidate.candidate.revision))) return null;
      const sourceNote = currentNotes.find((item) => noteId(item) === candidate.source.noteId);
      const candidateNote = currentNotes.find((item) => noteId(item) === candidate.candidate.noteId);
      if (!sourceNote || !candidateNote) return null;
      return {
        relationship: candidate,
        notes: [
          { noteId: noteId(sourceNote), title: stringValue(sourceNote.title), occurredAt: isoDate(sourceNote.createdAt || sourceNote.updatedAt), excerpt: candidate.source.excerpt },
          { noteId: noteId(candidateNote), title: stringValue(candidateNote.title), occurredAt: isoDate(candidateNote.createdAt || candidateNote.updatedAt), excerpt: candidate.candidate.excerpt },
        ],
      };
    }
  }
  return null;
}

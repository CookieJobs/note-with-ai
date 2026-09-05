import MemoryInsight from '../models/MemoryInsight';
import MemorySuppression from '../models/MemorySuppression';
import NoteAiPreference from '../models/NoteAiPreference';
import { Note } from '../models/Note';
import { ErrorHandler } from '../utils/errorHandler';
import { createHash } from 'node:crypto';

function objectId(value: unknown): string { return String((value as any)?._id ?? value); }

function display(insight: any) {
  return {
    id: objectId(insight),
    kind: insight.kind,
    statement: insight.statement,
    displayStatement: insight.userCorrection || insight.statement,
    status: insight.status,
    confidence: insight.confidence,
    evidence: Array.isArray(insight.evidence) ? insight.evidence.map((item: any) => ({
      noteId: objectId(item.noteId), noteRevision: item.noteRevision, excerpt: item.excerpt, capturedAt: item.capturedAt,
    })) : [],
    generatedAt: insight.generatedAt,
    updatedAt: insight.updatedAt,
  };
}

const SENSITIVE_MEMORY_TERMS = /(?:疾病|病情|医疗|心理|抑郁|焦虑|政治|党派|宗教|性取向|怀孕|收入|工资|负债|资产|投资)/i;
function fingerprint(kind: string, statement: string): string {
  return createHash('sha256').update(`${kind}:${statement.trim().toLowerCase().replace(/\s+/g, ' ')}`).digest('hex');
}
function statedGoalEvidence(value: string): string | null {
  const match = value.match(/(?:我想|我要|计划|希望)\s*([^。！？!?\n]{3,100})/);
  if (!match) return null;
  const excerpt = match[0].trim().replace(/[。！？!?]+$/, '');
  return SENSITIVE_MEMORY_TERMS.test(excerpt) ? null : excerpt;
}

class MemoryInsightService {
  async generateProposals(userId: string) {
    const excluded = await NoteAiPreference.find({ userId, included: false }).select('noteId').lean();
    const excludedIds = (excluded as any[]).map((value) => value.noteId);
    const notes = await Note.find({ userId, _id: { $nin: excludedIds } }).sort({ updatedAt: -1 }).limit(30).lean();
    let created = 0;
    for (const note of notes as any[]) {
      const excerpt = statedGoalEvidence(String(note.contentText || ''));
      if (!excerpt) continue;
      const statement = `你提到希望${excerpt.replace(/^(?:我想|我要|计划|希望)\s*/, '')}`;
      const value = fingerprint('stated_goal', statement);
      if (await this.isSuppressed(userId, value)) continue;
      if (await MemoryInsight.findOne({ userId, fingerprint: value })) continue;
      await MemoryInsight.create({
        userId, kind: 'stated_goal', statement, status: 'proposed', confidence: 'tentative', fingerprint: value,
        evidence: [{ noteId: note._id, noteRevision: note.revision || 1, excerpt, capturedAt: note.updatedAt || new Date() }],
      });
      created += 1;
    }
    return { created };
  }
  async list(userId: string) {
    const insights = await MemoryInsight.find({ userId }).sort({ updatedAt: -1 }).lean();
    const visible = [];
    for (const insight of insights as any[]) {
      const evidence = [];
      for (const item of insight.evidence || []) {
        const note = await Note.findOne({ _id: item.noteId, userId, revision: item.noteRevision }).lean();
        const text = String((note as any)?.contentText || (note as any)?.content || '');
        if (note && text.includes(String(item.excerpt || ''))) evidence.push(item);
      }
      if (evidence.length > 0) visible.push(display({ ...insight, evidence }));
    }
    return visible;
  }

  async confirm(userId: string, id: string) {
    const existing = await MemoryInsight.findOne({ _id: id, userId });
    if (!existing) throw ErrorHandler.createNotFoundError('AI 记忆不存在或无权限');
    if ((existing as any).status === 'corrected') return display(existing);
    const insight = await MemoryInsight.findOneAndUpdate({ _id: id, userId }, { $set: { status: 'confirmed' } }, { new: true });
    return display(insight || existing);
  }

  async correct(userId: string, id: string, correction: string) {
    const existing = await MemoryInsight.findOne({ _id: id, userId });
    if (!existing) throw ErrorHandler.createNotFoundError('AI 记忆不存在或无权限');
    const insight = await MemoryInsight.findOneAndUpdate(
      { _id: id, userId },
      { $set: { status: 'corrected', userCorrection: correction.trim() } },
      { new: true },
    );
    const fingerprint = String((existing as any).fingerprint);
    await MemorySuppression.updateOne(
      { userId, fingerprint },
      { $setOnInsert: { userId, fingerprint, reason: 'superseded_by_correction' } },
      { upsert: true },
    );
    return display(insight || existing);
  }

  async delete(userId: string, id: string) {
    const existing = await MemoryInsight.findOne({ _id: id, userId });
    if (!existing) throw ErrorHandler.createNotFoundError('AI 记忆不存在或无权限');
    const fingerprint = String((existing as any).fingerprint);
    await MemorySuppression.updateOne(
      { userId, fingerprint },
      { $setOnInsert: { userId, fingerprint, reason: 'deleted_by_user' } },
      { upsert: true },
    );
    await MemoryInsight.deleteOne({ _id: id, userId });
    return { id, fingerprint };
  }

  async isSuppressed(userId: string, fingerprint: string) {
    return Boolean(await MemorySuppression.exists({ userId, fingerprint }));
  }

  async getNotePreference(userId: string, noteId: string) {
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    const preference = await NoteAiPreference.findOne({ userId, noteId }).lean();
    return { noteId, included: preference ? Boolean((preference as any).included) : true };
  }

  async setNotePreference(userId: string, noteId: string, included: boolean) {
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    await NoteAiPreference.findOneAndUpdate(
      { userId, noteId },
      { $set: { included, updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!included) {
      const affected = await MemoryInsight.find({ userId, 'evidence.noteId': noteId }).lean();
      for (const insight of affected as any[]) {
        const evidence = (insight.evidence || []).filter((item: any) => String(item.noteId) !== noteId);
        if (evidence.length === 0) {
          await MemoryInsight.deleteOne({ _id: insight._id, userId });
        } else {
          await MemoryInsight.updateOne({ _id: insight._id, userId }, { $set: { evidence } });
        }
      }
      await Note.updateMany(
        { userId, $or: [{ _id: noteId }, { [`recommendCache.byCandidateId.${noteId}`]: { $exists: true } }] },
        { $set: { recommendCache: null } },
      );
    }
    return { noteId, included };
  }
}

export const memoryInsightService = new MemoryInsightService();

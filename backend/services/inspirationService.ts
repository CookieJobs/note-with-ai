import { Note } from '../models/Note';
import InspirationItem from '../models/InspirationItem';
import { inspirationCatalogService } from './inspirationCatalogService';
import { inspirationResearchGate } from './inspirationResearchGate';
import { inspirationScheduleService } from './inspirationScheduleService';
import InspirationSource from '../models/InspirationSource';
import { tavilySearchProvider } from './tavilySearchProvider';
import { planResearch, sanitizeMetadata, synthesizeResearch } from './inspirationLlm';
import {
  inspirationError,
  type NoteContextReason,
  type InspirationDto,
  type LimitedNoteContext,
  type ResearchPlan,
  toInspirationDto,
} from './inspirationTypes';

type NoteRecord = {
  _id: { toString(): string } | string;
  revision?: number;
  title?: unknown;
  summary?: unknown;
  enrichment?: { meta?: { status?: string; sourceRevision?: number } } | null;
};

type InspirationServiceDependencies = {
  planner: typeof planResearch;
  search: typeof tavilySearchProvider.search;
  synthesizer: typeof synthesizeResearch;
};

type ManualResult = { status: 'created'; item: InspirationDto } | { status: 'no_result' };
type ContextUnavailableResult = { status: 'no_result'; reason: 'note_context_unavailable'; contextReason: NoteContextReason };
type ScheduledResult = ManualResult | ContextUnavailableResult | { status: 'cancelled' };

const defaultDependencies: InspirationServiceDependencies = {
  planner: planResearch,
  search: (query) => tavilySearchProvider.search(query),
  synthesizer: synthesizeResearch,
};

function idString(value: unknown): string {
  if (value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value || '');
}

function buildLimitedNotes(records: NoteRecord[]): LimitedNoteContext[] {
  return records.map((note) => {
    const revision = typeof note.revision === 'number' && Number.isInteger(note.revision) && note.revision > 0 ? note.revision : 1;
    const meta = note.enrichment?.meta;
    const summaryIsStale = typeof meta?.sourceRevision === 'number' && meta.sourceRevision !== revision;
    return {
      noteId: idString(note._id),
      revision,
      title: sanitizeMetadata(note.title, 80),
      summary: summaryIsStale ? '' : sanitizeMetadata(note.summary, 120),
    };
  }).filter((note) => note.title || note.summary);
}

function unavailableReason(records: NoteRecord[]): NoteContextReason {
  if (!records.length) return 'no_notes';
  return records.some((note) => (note.enrichment?.meta?.status === 'pending' || note.enrichment?.meta?.status === 'missing')
    && (note.enrichment.meta.sourceRevision === undefined || note.enrichment.meta.sourceRevision === note.revision))
    ? 'summary_pending' : 'context_unavailable';
}

function errorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'number'
    ? (error as { code: number }).code
    : undefined;
}

class InspirationService {
  private readonly activeRequests = new Map<string, Promise<ManualResult>>();

  constructor(private readonly dependencies: InspirationServiceDependencies) {}

  async request(userId: string): Promise<ManualResult> {
    if (this.activeRequests.has(userId)) throw inspirationError('INSPIRATION_IN_PROGRESS', 409);
    const active = this.runManual(userId);
    this.activeRequests.set(userId, active);
    try {
      return await active;
    } finally {
      if (this.activeRequests.get(userId) === active) this.activeRequests.delete(userId);
    }
  }

  async runScheduled(userId: string, canContinue: () => Promise<boolean>): Promise<ScheduledResult> {
    const token = await inspirationResearchGate.acquire(userId, 'scheduled');
    if (!token) throw inspirationError('INSPIRATION_IN_PROGRESS', 409);
    try {
      const allowed = async () => await inspirationScheduleService.isEnabled(userId) && await canContinue();
      return await this.performResearch(userId, 'scheduled', allowed);
    } finally {
      await inspirationResearchGate.release(userId, token);
    }
  }

  private async runManual(userId: string): Promise<ManualResult> {
    const token = await inspirationResearchGate.acquire(userId, 'manual');
    if (!token) throw inspirationError('INSPIRATION_IN_PROGRESS', 409);
    try {
      await inspirationScheduleService.recordManualStart(userId);
      const result = await this.performResearch(userId, 'manual');
      if (result.status === 'no_result' && 'reason' in result) {
        throw inspirationError('INSPIRATION_NOTE_CONTEXT_UNAVAILABLE', 409, result.contextReason);
      }
      return result.status === 'cancelled' ? { status: 'no_result' } : result;
    } finally {
      await inspirationResearchGate.release(userId, token);
    }
  }

  async latest(userId: string): Promise<InspirationDto | null> {
    return inspirationCatalogService.latest(userId);
  }

  private async performResearch(
    userId: string,
    origin: 'manual' | 'scheduled',
    canContinue?: () => Promise<boolean>,
  ): Promise<ScheduledResult> {
    const records = await Note.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('_id revision title summary enrichment.meta updatedAt')
      .lean() as NoteRecord[];
    const notes = buildLimitedNotes(records);
    if (!notes.length) return { status: 'no_result', reason: 'note_context_unavailable', contextReason: unavailableReason(records) };

    if (canContinue && !await canContinue()) return { status: 'cancelled' };
    const plan: ResearchPlan = await this.dependencies.planner(notes, userId);
    if (canContinue && !await canContinue()) return { status: 'cancelled' };
    const candidates = await this.dependencies.search(plan.query);
    if (!candidates.length) return { status: 'no_result' };

    const usedSources = await InspirationSource.find({
      userId,
      canonicalUrl: { $in: candidates.map((source) => source.canonicalUrl) },
    }).select('canonicalUrl').lean() as unknown as Array<{ canonicalUrl: string }>;
    const usedUrls = new Set(usedSources.map((entry) => entry.canonicalUrl));
    const availableSources = candidates.filter((source) => !usedUrls.has(source.canonicalUrl)).slice(0, 3);
    if (!availableSources.length) return { status: 'no_result' };

    if (canContinue && !await canContinue()) return { status: 'cancelled' };
    const draft = await this.dependencies.synthesizer(plan, notes, availableSources, userId);
    const citedSources = availableSources.filter((source) => draft.sourceIds.includes(source.sourceId));
    if (!citedSources.length) throw inspirationError('INSPIRATION_SYNTHESIS_FAILED', 502);

    const created = await InspirationItem.create({
      userId,
      relatedNotes: notes.map(({ noteId, revision }) => ({ noteId, revision })),
      topicLabel: plan.topicLabel,
      headline: draft.headline,
      brief: draft.brief,
      whyRelevant: draft.whyRelevant,
      nextQuestion: draft.nextQuestion,
      sources: citedSources,
      status: 'draft',
      userState: 'regular',
      origin,
    });
    const inspirationId = idString((created as unknown as Record<string, unknown>)._id);

    try {
      await InspirationSource.insertMany(citedSources.map((source) => ({
        userId,
        canonicalUrl: source.canonicalUrl,
        inspirationId,
      })));
      const completion = await InspirationItem.updateOne(
        { _id: inspirationId, userId, status: 'draft' },
        { $set: { status: 'completed' } },
      );
      if (completion.matchedCount !== 1 || completion.modifiedCount !== 1) {
        throw new Error('Inspiration draft could not be completed');
      }
    } catch (error) {
      await InspirationSource.deleteMany({ userId, inspirationId });
      await InspirationItem.deleteOne({ _id: inspirationId, userId, status: 'draft' });
      if (errorCode(error) === 11000) return { status: 'no_result' };
      throw error;
    }

    return { status: 'created', item: toInspirationDto(created as unknown as Record<string, unknown>) };
  }
}

export function createInspirationService(dependencies: Partial<InspirationServiceDependencies> = {}) {
  return new InspirationService({ ...defaultDependencies, ...dependencies });
}

export const inspirationService = createInspirationService();

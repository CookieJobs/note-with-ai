import { Note } from '../models/Note';
import InspirationItem from '../models/InspirationItem';
import InspirationSource from '../models/InspirationSource';
import { tavilySearchProvider } from './tavilySearchProvider';
import { planResearch, sanitizeMetadata, synthesizeResearch } from './inspirationLlm';
import {
  inspirationError,
  type InspirationDto,
  type LimitedNoteContext,
  type ResearchPlan,
  type ResearchSource,
} from './inspirationTypes';

type NoteRecord = {
  _id: { toString(): string } | string;
  revision?: number;
  title?: unknown;
  keywords?: unknown;
  summary?: unknown;
};

type InspirationServiceDependencies = {
  planner: typeof planResearch;
  search: typeof tavilySearchProvider.search;
  synthesizer: typeof synthesizeResearch;
};

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
    const keywords = Array.isArray(note.keywords)
      ? note.keywords.slice(0, 3).map((keyword) => sanitizeMetadata(keyword, 40)).filter(Boolean)
      : [];
    return {
      noteId: idString(note._id),
      revision: typeof note.revision === 'number' && Number.isInteger(note.revision) && note.revision > 0 ? note.revision : 1,
      title: sanitizeMetadata(note.title, 80),
      keywords,
      summary: sanitizeMetadata(note.summary, 120),
    };
  }).filter((note) => note.title || note.keywords.length || note.summary);
}

function sourceDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function sourceToDto(source: Record<string, unknown>): ResearchSource {
  return {
    sourceId: String(source.sourceId || ''),
    canonicalUrl: String(source.canonicalUrl || ''),
    title: String(source.title || ''),
    publisher: String(source.publisher || ''),
    snippet: String(source.snippet || ''),
    retrievedAt: sourceDate(source.retrievedAt),
  };
}

function toDto(item: Record<string, unknown>): InspirationDto {
  const sources = Array.isArray(item.sources)
    ? item.sources.map((source) => sourceToDto(source as Record<string, unknown>))
    : [];
  return {
    id: idString(item._id),
    topicLabel: String(item.topicLabel || ''),
    headline: String(item.headline || ''),
    brief: String(item.brief || ''),
    whyRelevant: String(item.whyRelevant || ''),
    nextQuestion: String(item.nextQuestion || ''),
    sources,
    createdAt: sourceDate(item.createdAt),
  };
}

function errorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'number'
    ? (error as { code: number }).code
    : undefined;
}

class InspirationService {
  private readonly activeRequests = new Map<string, Promise<{ status: 'created'; item: InspirationDto } | { status: 'no_result' }>>();

  constructor(private readonly dependencies: InspirationServiceDependencies) {}

  async request(userId: string): Promise<{ status: 'created'; item: InspirationDto } | { status: 'no_result' }> {
    if (this.activeRequests.has(userId)) throw inspirationError('INSPIRATION_IN_PROGRESS', 409);
    const active = this.performResearch(userId);
    this.activeRequests.set(userId, active);
    try {
      return await active;
    } finally {
      if (this.activeRequests.get(userId) === active) this.activeRequests.delete(userId);
    }
  }

  async latest(userId: string): Promise<InspirationDto | null> {
    const item = await InspirationItem.findOne({ userId, status: 'completed' })
      .sort({ createdAt: -1 })
      .lean();
    return item ? toDto(item as Record<string, unknown>) : null;
  }

  private async performResearch(userId: string): Promise<{ status: 'created'; item: InspirationDto } | { status: 'no_result' }> {
    const records = await Note.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('_id revision title keywords summary updatedAt')
      .lean() as NoteRecord[];
    const notes = buildLimitedNotes(records);
    if (!notes.length) return { status: 'no_result' };

    const plan: ResearchPlan = await this.dependencies.planner(notes, userId);
    const candidates = await this.dependencies.search(plan.query);
    if (!candidates.length) return { status: 'no_result' };

    const usedSources = await InspirationSource.find({
      userId,
      canonicalUrl: { $in: candidates.map((source) => source.canonicalUrl) },
    }).select('canonicalUrl').lean() as unknown as Array<{ canonicalUrl: string }>;
    const usedUrls = new Set(usedSources.map((entry) => entry.canonicalUrl));
    const availableSources = candidates.filter((source) => !usedUrls.has(source.canonicalUrl)).slice(0, 3);
    if (!availableSources.length) return { status: 'no_result' };

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

    return { status: 'created', item: toDto(created as unknown as Record<string, unknown>) };
  }
}

export function createInspirationService(dependencies: Partial<InspirationServiceDependencies> = {}) {
  return new InspirationService({ ...defaultDependencies, ...dependencies });
}

export const inspirationService = createInspirationService();

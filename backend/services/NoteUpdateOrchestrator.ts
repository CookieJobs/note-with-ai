import { Note } from '../models/Note';
import {
  extractPlainTextFromRichText,
  normalizePlainText,
  NoteBodyValidationError,
  type JsonDocument,
} from './noteContentNormalizer';
import { createProductionNoteEnrichmentScheduler } from './noteEnrichmentWorker';
import { logger } from '../utils/logger';

export type NoteBodyInput =
  | { kind: 'rich-text'; document: JsonDocument; fallbackMarkdown?: string }
  | { kind: 'plain-text'; text: string };

export type NoteArtifact = 'meta' | 'embedding' | 'recommendations';
export type ArtifactStatus = 'missing' | 'pending' | 'ready' | 'failed';

export type ArtifactState = {
  status: ArtifactStatus;
  sourceRevision: number;
  attemptedAt?: Date | string;
  errorCode?: string;
};

export type NoteEnrichmentState = Record<NoteArtifact, ArtifactState>;

export type NoteDto = {
  _id: string;
  content: string;
  contentJson: JsonDocument | null;
  contentText: string;
  title: string;
  summary: string;
  concepts: string[];
  keywords: string[];
  recommendCache: Record<string, unknown> | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type EnrichmentView = {
  sourceRevision: number;
  status: 'pending' | 'ready' | 'degraded';
};

export type NoteWriteResult = {
  note: NoteDto;
  enrichment: EnrichmentView;
};

export type CreateNoteInput = {
  userId: string;
  body: NoteBodyInput;
};

export type UpdateNoteInput = {
  userId: string;
  noteId: string;
  expectedRevision: number;
  changes: {
    body?: NoteBodyInput;
    title?: string;
    keywords?: string[];
  };
};

export type EnrichmentTask = {
  noteId: string;
  userId: string;
  sourceRevision: number;
  artifact: NoteArtifact;
};

export interface EnrichmentScheduler {
  schedule(task: EnrichmentTask): void;
}

type NoteRecord = {
  _id: unknown;
  userId: unknown;
  content: unknown;
  contentText?: unknown;
  contentJson?: unknown;
  title?: unknown;
  titleOrigin?: unknown;
  summary?: unknown;
  concepts?: unknown;
  keywords?: unknown;
  keywordsOrigin?: unknown;
  recommendCache?: unknown;
  revision?: unknown;
  enrichment?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

export type NoteWriteErrorCode =
  | 'NOTE_BODY_EMPTY'
  | 'NOTE_BODY_INVALID'
  | 'NOTE_PATCH_EMPTY'
  | 'NOTE_NOT_FOUND'
  | 'NOTE_WRITE_CONFLICT'
  | 'NOTE_WRITE_FAILED';

export class NoteWriteError extends Error {
  constructor(
    public readonly code: NoteWriteErrorCode,
    message: string,
    public readonly statusCode: 400 | 404 | 409 | 500,
    public readonly current?: NoteWriteResult,
  ) {
    super(message);
    this.name = 'NoteWriteError';
  }
}

type PreparedBody = {
  content: string;
  contentText: string;
  contentJson: JsonDocument | null;
};

const ARTIFACTS: NoteArtifact[] = ['meta', 'embedding', 'recommendations'];
const DEFAULT_STALE_ENRICHMENT_MS = 5 * 60 * 1000;

function getStaleEnrichmentMs(): number {
  const value = Number(process.env.NOTE_ENRICHMENT_STALE_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STALE_ENRICHMENT_MS;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRevision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

function toIsoDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = asRecord(value);
  if (record) {
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeKeywords(value: string[]): string[] {
  return value.map((keyword) => keyword.trim()).filter(Boolean);
}

function advanceRecommendCache(value: unknown, sourceRevision: number): Record<string, unknown> | null | undefined {
  const cache = asRecord(value);
  if (!cache) return undefined;
  return { ...cache, sourceRevision };
}

function firstLineTitle(contentText: string): string {
  return contentText.split('\n')[0].trim().slice(0, 100);
}

function newArtifactState(sourceRevision: number, status: ArtifactStatus = 'pending'): ArtifactState {
  return {
    status,
    sourceRevision,
    ...(status === 'pending' ? { attemptedAt: new Date() } : {}),
  };
}

function getArtifactState(value: unknown, artifact: NoteArtifact, revision: number): ArtifactState {
  const record = asRecord(value);
  const candidate = asRecord(record?.[artifact]);
  if (!candidate) return newArtifactState(revision, 'missing');
  const status = candidate.status;
  if (status !== 'missing' && status !== 'pending' && status !== 'ready' && status !== 'failed') {
    return newArtifactState(revision, 'missing');
  }
  return {
    status,
    sourceRevision: asRevision(candidate.sourceRevision),
    ...(candidate.attemptedAt ? { attemptedAt: candidate.attemptedAt as string | Date } : {}),
    ...(typeof candidate.errorCode === 'string' ? { errorCode: candidate.errorCode } : {}),
  };
}

function getEnrichmentState(value: unknown, revision: number): NoteEnrichmentState {
  return {
    meta: getArtifactState(value, 'meta', revision),
    embedding: getArtifactState(value, 'embedding', revision),
    recommendations: getArtifactState(value, 'recommendations', revision),
  };
}

export function getEnrichmentView(note: Pick<NoteRecord, 'revision' | 'enrichment'>): EnrichmentView {
  const revision = asRevision(note.revision);
  const state = getEnrichmentState(note.enrichment, revision);
  const artifactStates = ARTIFACTS.map((artifact) => state[artifact]);
  const hasFreshPending = artifactStates.some((artifact) =>
    artifact.status === 'pending'
    && artifact.sourceRevision === revision
    && artifact.attemptedAt !== undefined
    && Date.now() - new Date(artifact.attemptedAt).getTime() < getStaleEnrichmentMs(),
  );
  if (hasFreshPending) return { sourceRevision: revision, status: 'pending' };
  if (artifactStates.every((artifact) => artifact.status === 'ready' && artifact.sourceRevision === revision)) {
    return { sourceRevision: revision, status: 'ready' };
  }
  return { sourceRevision: revision, status: 'degraded' };
}

export function toNoteDto(value: NoteRecord): NoteDto {
  const contentText = asString(value.contentText).trim() || asString(value.content);
  const contentJson = asRecord(value.contentJson);
  const recommendCache = asRecord(value.recommendCache);
  return {
    _id: String(value._id),
    content: asString(value.content),
    contentText,
    contentJson,
    title: asString(value.title),
    summary: asString(value.summary),
    concepts: asStringArray(value.concepts),
    keywords: asStringArray(value.keywords),
    recommendCache,
    revision: asRevision(value.revision),
    createdAt: toIsoDate(value.createdAt),
    updatedAt: toIsoDate(value.updatedAt),
  };
}

function prepareBody(body: NoteBodyInput): PreparedBody {
  try {
    if (body.kind === 'plain-text') {
      if (typeof body.text !== 'string') {
        throw new NoteBodyValidationError('NOTE_BODY_INVALID', '纯文本正文格式无效');
      }
      const contentText = normalizePlainText(body.text);
      if (!contentText) throw new NoteBodyValidationError('NOTE_BODY_EMPTY', '笔记正文不能为空');
      return { content: contentText, contentText, contentJson: null };
    }

    if (body.kind === 'rich-text') {
      if (!asRecord(body.document)) {
        throw new NoteBodyValidationError('NOTE_BODY_INVALID', '富文本正文格式无效');
      }
      const contentText = extractPlainTextFromRichText(body.document);
      if (body.fallbackMarkdown !== undefined && typeof body.fallbackMarkdown !== 'string') {
        throw new NoteBodyValidationError('NOTE_BODY_INVALID', '富文本 fallbackMarkdown 格式无效');
      }
      const fallback = body.fallbackMarkdown?.trim();
      return { content: fallback || contentText, contentText, contentJson: body.document };
    }
  } catch (error) {
    if (error instanceof NoteBodyValidationError) {
      throw new NoteWriteError(error.code, error.message, 400);
    }
    throw error;
  }

  throw new NoteWriteError('NOTE_BODY_INVALID', '笔记正文格式无效', 400);
}

function hasOwnChanges(changes: UpdateNoteInput['changes']): boolean {
  return changes.body !== undefined || changes.title !== undefined || changes.keywords !== undefined;
}

function writeFailed(error: unknown): NoteWriteError {
  if (error instanceof NoteWriteError) return error;
  return new NoteWriteError('NOTE_WRITE_FAILED', '笔记写入失败', 500);
}

function equalStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export class NoteUpdateOrchestrator {
  private readonly scheduler: EnrichmentScheduler;

  constructor(dependencies: { scheduler: EnrichmentScheduler }) {
    this.scheduler = dependencies.scheduler;
  }

  async create(input: CreateNoteInput): Promise<NoteWriteResult> {
    const startedAt = Date.now();
    const body = prepareBody(input.body);
    const revision = 1;
    const enrichment: NoteEnrichmentState = {
      meta: newArtifactState(revision),
      embedding: newArtifactState(revision),
      recommendations: newArtifactState(revision),
    };
    let created: NoteRecord;
    try {
      created = await Note.create({
        userId: input.userId,
        content: body.content,
        contentText: body.contentText,
        contentJson: body.contentJson,
        title: firstLineTitle(body.contentText),
        titleOrigin: 'default',
        summary: '',
        concepts: [],
        keywords: [],
        keywordsOrigin: 'default',
        recommendCache: null,
        revision,
        enrichment,
      }) as unknown as NoteRecord;
    } catch (error) {
      logger.warn('capture_save_failed', { userId: input.userId, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
      throw writeFailed(error);
    }
    const result = this.toResult(created);
    logger.info('capture_saved', { userId: input.userId, noteId: result.note._id, durationMs: Date.now() - startedAt, clientType: 'unknown' });
    for (const artifact of ARTIFACTS) {
      this.scheduler.schedule({ noteId: result.note._id, userId: input.userId, sourceRevision: revision, artifact });
    }
    return result;
  }

  async update(input: UpdateNoteInput): Promise<NoteWriteResult> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new NoteWriteError('NOTE_BODY_INVALID', 'expectedRevision 无效', 400);
    }
    if (!hasOwnChanges(input.changes)) {
      throw new NoteWriteError('NOTE_PATCH_EMPTY', '笔记更新不能为空', 400);
    }

    const body = input.changes.body === undefined ? undefined : prepareBody(input.changes.body);
    let current: NoteRecord | null;
    try {
      current = await Note.findOne({ _id: input.noteId, userId: input.userId }) as unknown as NoteRecord | null;
    } catch (error) {
      throw writeFailed(error);
    }
    if (!current) throw new NoteWriteError('NOTE_NOT_FOUND', '笔记不存在或无权限', 404);
    if (asRevision(current.revision) !== input.expectedRevision) {
      throw this.conflict(current);
    }

    const currentDto = toNoteDto(current);
    const nextTitle = input.changes.title === undefined ? currentDto.title : input.changes.title.trim();
    const nextKeywords = input.changes.keywords === undefined
      ? currentDto.keywords
      : normalizeKeywords(input.changes.keywords);
    const bodyChanged = body !== undefined && (
      body.content !== currentDto.content
      || body.contentText !== currentDto.contentText
      || stableJson(body.contentJson) !== stableJson(currentDto.contentJson)
    );
    const contentTextChanged = body !== undefined && body.contentText !== currentDto.contentText;
    const titleChanged = nextTitle !== currentDto.title;
    const keywordsChanged = !equalStringArrays(nextKeywords, currentDto.keywords);

    if (!bodyChanged && !titleChanged && !keywordsChanged) return this.toResult(current);

    const nextRevision = input.expectedRevision + 1;
    const invalidated = new Set<NoteArtifact>();
    if (contentTextChanged) {
      invalidated.add('meta');
      invalidated.add('embedding');
      invalidated.add('recommendations');
    } else if (titleChanged) {
      invalidated.add('recommendations');
    }

    const nextEnrichment = this.advanceEnrichment(current.enrichment, nextRevision, invalidated);
    const nextRecommendCache = invalidated.has('recommendations')
      ? null
      : advanceRecommendCache(current.recommendCache, nextRevision);
    let updated: NoteRecord | null;
    try {
      updated = await Note.findOneAndUpdate(
        { _id: input.noteId, userId: input.userId, revision: input.expectedRevision },
        {
          $set: {
            ...(bodyChanged && body ? body : {}),
            ...(titleChanged ? { title: nextTitle } : {}),
            ...(titleChanged ? { titleOrigin: 'user' } : {}),
            ...(keywordsChanged ? { keywords: nextKeywords } : {}),
            ...(keywordsChanged ? { keywordsOrigin: 'user' } : {}),
            ...(nextRecommendCache !== undefined ? { recommendCache: nextRecommendCache } : {}),
            enrichment: nextEnrichment,
          },
          $inc: { revision: 1 },
        },
        { new: true, runValidators: true },
      ) as unknown as NoteRecord | null;
    } catch (error) {
      throw writeFailed(error);
    }
    if (!updated) {
      let latest: NoteRecord | null;
      try {
        latest = await Note.findOne({ _id: input.noteId, userId: input.userId }) as unknown as NoteRecord | null;
      } catch (error) {
        throw writeFailed(error);
      }
      if (!latest) throw new NoteWriteError('NOTE_NOT_FOUND', '笔记不存在或无权限', 404);
      throw this.conflict(latest);
    }

    const result = this.toResult(updated);
    for (const artifact of ARTIFACTS) {
      if (invalidated.has(artifact) || getArtifactState(current.enrichment, artifact, input.expectedRevision).status === 'pending') {
        this.scheduler.schedule({ noteId: result.note._id, userId: input.userId, sourceRevision: nextRevision, artifact });
      }
    }
    return result;
  }

  private advanceEnrichment(
    current: unknown,
    nextRevision: number,
    invalidated: Set<NoteArtifact>,
  ): NoteEnrichmentState {
    const previous = getEnrichmentState(current, nextRevision - 1);
    return ARTIFACTS.reduce<NoteEnrichmentState>((next, artifact) => {
      const prior = previous[artifact];
      if (invalidated.has(artifact) || prior.status === 'pending') {
        next[artifact] = newArtifactState(nextRevision);
      } else if (prior.status === 'ready') {
        next[artifact] = { ...prior, sourceRevision: nextRevision };
      } else {
        next[artifact] = { ...prior, sourceRevision: nextRevision };
      }
      return next;
    }, {} as NoteEnrichmentState);
  }

  private toResult(note: NoteRecord): NoteWriteResult {
    return { note: toNoteDto(note), enrichment: getEnrichmentView(note) };
  }

  private conflict(note: NoteRecord): NoteWriteError {
    return new NoteWriteError('NOTE_WRITE_CONFLICT', '笔记已被其他写入更新', 409, this.toResult(note));
  }
}

export const noteWriteModule = new NoteUpdateOrchestrator({
  scheduler: createProductionNoteEnrichmentScheduler(),
});

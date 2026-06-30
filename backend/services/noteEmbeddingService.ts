/*
Input: 待生成、统计或待修复 embedding 的笔记记录
Output: 文本向量、embedding metadata、当前配置兼容覆盖率统计与修复结果
Pos: 后端 服务模块
Note: 文档向量统一写入 embedding 与 embeddingMetadata，并基于当前默认 provider/model/dimension/modality 保护检索与重建
*/
import { Types } from 'mongoose';
import { Note } from '../models/Note';
import { EMBEDDING_CONFIG } from '../config/embedding';
import { INote } from '../types';
import {
  buildNoteEmbeddingMetadataFilter,
  buildNoteEmbeddingMetadata,
  EmbeddingGenerationOptions,
  generateEmbedding,
  generateEmbeddingsBatch,
} from '../utils/embedding';
import { logger } from '../utils/logger';

type EmbeddingNote = Pick<INote, 'title' | 'content' | 'contentText' | 'updatedAt'> & {
  _id: INote['_id'];
  userId: INote['userId'];
};

type EmbeddingWriteTarget = {
  _id: string;
  userId: string;
  updatedAt: Date;
};

export interface EmbeddingStats {
  totalNotes: number;
  notesWithEmbedding: number;
  notesWithoutEmbedding: number;
  notesWithCurrentEmbedding: number;
  notesWithOutdatedEmbedding: number;
  embeddingCoverage: number;
  currentConfigCoverage: number;
  pendingNotes: string[];
}

export interface EmbeddingMaintenanceResult {
  processedCount: number;
  successCount: number;
  failureCount: number;
  failures?: Array<{
    noteId: string;
    error: string;
  }>;
}

class NoteEmbeddingService {
  private readonly documentInputType = EMBEDDING_CONFIG.DEFAULTS.INPUT_TYPES.DOCUMENT;
  private readonly documentEmbeddingOptions: EmbeddingGenerationOptions = {
    inputType: EMBEDDING_CONFIG.DEFAULTS.INPUT_TYPES.DOCUMENT,
    modality: EMBEDDING_CONFIG.DEFAULTS.MODALITY,
  };

  private normalizeText(value: unknown) {
    return String(value || '').trim();
  }

  private buildExistingEmbeddingFilter() {
    return {
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } },
    };
  }

  private buildMetadataMismatchFilter() {
    const expected = buildNoteEmbeddingMetadataFilter(this.documentEmbeddingOptions);
    return {
      ...this.buildExistingEmbeddingFilter(),
      $or: [
        { embeddingMetadata: { $exists: false } },
        { embeddingMetadata: null },
        ...Object.entries(expected).map(([field, value]) => ({ [field]: { $ne: value } })),
      ],
    };
  }

  buildEmbeddingText(note: Pick<Partial<EmbeddingNote>, 'content' | 'contentText' | 'title'>) {
    const richTextBody = this.normalizeText(note.contentText);
    if (richTextBody) return richTextBody;

    const legacyBody = this.normalizeText(note.content);
    if (legacyBody) return legacyBody;

    return this.normalizeText(note.title || '');
  }

  private buildPendingFilter(userId?: string) {
    const filter: Record<string, unknown> = {
      $or: [
        { embedding: { $exists: false } },
        { embedding: { $size: 0 } },
        { embedding: null },
        this.buildMetadataMismatchFilter(),
      ],
    };
    if (userId) filter.userId = userId;
    return filter;
  }

  private buildCurrentEmbeddingFilter(userId?: string) {
    const filter: Record<string, unknown> = {
      ...this.buildExistingEmbeddingFilter(),
      ...buildNoteEmbeddingMetadataFilter(this.documentEmbeddingOptions),
    };
    if (userId) filter.userId = userId;
    return filter;
  }

  private toMongoId(id: string) {
    return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : id;
  }

  private async saveEmbeddingIfFresh(note: EmbeddingWriteTarget, embedding: number[]) {
    const result = await Note.updateOne(
      { _id: note._id, userId: note.userId, updatedAt: note.updatedAt },
      {
        $set: {
          embedding,
          embeddingMetadata: buildNoteEmbeddingMetadata(this.documentEmbeddingOptions, embedding),
        },
      }
    );
    return !!result && (result as { matchedCount?: number }).matchedCount === 1 ? 'saved' : 'stale';
  }

  private async generateBatchWithRetry(texts: string[]) {
    const maxRetries = EMBEDDING_CONFIG.BATCH.MAX_RETRIES;
    let lastResult: number[][] = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      lastResult = await generateEmbeddingsBatch(texts, this.documentEmbeddingOptions);
      if (lastResult.length === texts.length) return lastResult;

      if (attempt < maxRetries) {
        logger.warn(`⚠️ embedding 批量生成结果不完整，准备重试 (${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, EMBEDDING_CONFIG.CRON.RETRY_DELAY_MS * attempt));
      }
    }

    return lastResult;
  }

  private async generateForNotes(notes: EmbeddingNote[]): Promise<EmbeddingMaintenanceResult> {
    const failures: Array<{ noteId: string; error: string }> = [];
    const candidates = notes
      .map((note) => {
        const text = this.buildEmbeddingText(note);
        if (text.length === 0) {
          failures.push({ noteId: note._id.toString(), error: '缺少可用于 embedding 的文本' });
          return null;
        }
        return { note, text };
      })
      .filter((item): item is { note: EmbeddingNote; text: string } => item !== null);

    if (candidates.length === 0) {
      return {
        processedCount: notes.length,
        successCount: 0,
        failureCount: failures.length,
        failures: failures.length > 0 ? failures : undefined,
      };
    }

    const embeddings = await this.generateBatchWithRetry(candidates.map(item => item.text));
    let successCount = 0;

    for (let index = 0; index < candidates.length; index++) {
      const { note } = candidates[index];
      const embedding = embeddings[index];

      if (!Array.isArray(embedding) || embedding.length === 0) {
        failures.push({ noteId: note._id.toString(), error: '向量生成失败或返回为空' });
        continue;
      }

      try {
        const saved = await this.saveEmbeddingIfFresh(
          {
            _id: note._id.toString(),
            userId: String(note.userId),
            updatedAt: note.updatedAt,
          },
          embedding
        );
        if (saved === 'saved') {
          successCount++;
        } else {
          failures.push({
            noteId: note._id.toString(),
            error: '笔记在 embedding 生成期间已更新，跳过旧向量写入',
          });
        }
      } catch (error: unknown) {
        failures.push({
          noteId: note._id.toString(),
          error: (error as Error).message || '写入 embedding 失败',
        });
      }
    }

    return {
      processedCount: notes.length,
      successCount,
      failureCount: failures.length,
      failures: failures.length > 0 ? failures : undefined,
    };
  }

  private async getStats(filter: Record<string, unknown>): Promise<EmbeddingStats> {
    const totalNotes = await Note.countDocuments(filter);
    const notesWithEmbedding = await Note.countDocuments({
      ...filter,
      ...this.buildExistingEmbeddingFilter(),
    });
    const userId = typeof filter.userId === 'string' ? filter.userId : undefined;
    const notesWithCurrentEmbedding = await Note.countDocuments(this.buildCurrentEmbeddingFilter(userId));
    const notesWithoutEmbedding = totalNotes - notesWithEmbedding;
    const notesWithOutdatedEmbedding = Math.max(notesWithEmbedding - notesWithCurrentEmbedding, 0);
    const embeddingCoverage = totalNotes > 0 ? Math.round((notesWithEmbedding / totalNotes) * 10000) / 100 : 0;
    const currentConfigCoverage = totalNotes > 0
      ? Math.round((notesWithCurrentEmbedding / totalNotes) * 10000) / 100
      : 0;

    const pendingNotes = await Note.find(this.buildPendingFilter(userId))
      .select('_id')
      .limit(100);

    return {
      totalNotes,
      notesWithEmbedding,
      notesWithoutEmbedding,
      notesWithCurrentEmbedding,
      notesWithOutdatedEmbedding,
      embeddingCoverage,
      currentConfigCoverage,
      pendingNotes: pendingNotes.map((note) => note._id.toString()),
    };
  }

  scheduleEmbeddingUpdate(params: {
    noteId: string;
    userId: string;
    updatedAt: Date;
    title?: string;
    content?: string;
    contentText?: string;
  }) {
    const { noteId, userId, updatedAt, title, content, contentText } = params;
    const normalizedText = this.buildEmbeddingText({ title, content, contentText });
    if (!normalizedText) return;

    void (async () => {
      try {
        const embedding = await generateEmbedding(normalizedText, this.documentEmbeddingOptions);
        if (!Array.isArray(embedding) || embedding.length === 0) return;

        await this.saveEmbeddingIfFresh({ _id: noteId, userId, updatedAt }, embedding);
      } catch (error: unknown) {
        logger.warn('⚠️ embedding 异步生成失败（已忽略）:', error);
      }
    })();
  }

  async generateEmbeddingForNote(userId: string, noteId: string): Promise<{ embedding?: number[]; skipped?: boolean }> {
    const note = await Note.findOne({ _id: noteId, userId })
      .select('_id userId title content contentText updatedAt');
    if (!note) {
      return { skipped: true };
    }

    const text = this.buildEmbeddingText(note as unknown as EmbeddingNote);
    if (!text) return { skipped: true };

    const embedding = await generateEmbedding(text, this.documentEmbeddingOptions);
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { skipped: true };
    }

    const saved = await this.saveEmbeddingIfFresh(
      {
        _id: note._id.toString(),
        userId: String(note.userId),
        updatedAt: note.updatedAt,
      },
      embedding
    );
    if (saved !== 'saved') {
      return { skipped: true };
    }

    logger.info('✅ embedding 保存成功');
    return { embedding };
  }

  async ensureUserEmbeddings(userId: string, limitNum: number = 20): Promise<{ processed: number; success: number }> {
    const limit = Math.max(1, Math.min(50, limitNum));
    const pending = await Note.find({
      ...this.buildPendingFilter(userId),
    })
      .select('_id userId title content contentText updatedAt')
      .limit(limit);

    if (pending.length === 0) {
      return { processed: 0, success: 0 };
    }

    const result = await this.generateForNotes(pending as unknown as EmbeddingNote[]);
    return {
      processed: result.processedCount,
      success: result.successCount,
    };
  }

  async getUserEmbeddingStats(userId: string): Promise<EmbeddingStats> {
    return this.getStats({ userId });
  }

  async getGlobalEmbeddingStats(): Promise<EmbeddingStats> {
    return this.getStats({});
  }

  async repairAllEmbeddings(): Promise<EmbeddingMaintenanceResult> {
    const batchSize = Number(process.env.EMBEDDING_BATCH_SIZE) || EMBEDDING_CONFIG.BATCH.SIZE;
    let totalProcessed = 0;
    let totalSuccess = 0;
    const allFailures: Array<{ noteId: string; error: string }> = [];
    const skippedIds = new Set<string>();
    let hasMore = true;
    let batchIndex = 1;

    logger.info(`🚀 开始全量修复任务 (Batch Size: ${batchSize})`, {
      provider: this.documentEmbeddingOptions.provider || EMBEDDING_CONFIG.DEFAULTS.PROVIDER,
      model: this.documentEmbeddingOptions.model || EMBEDDING_CONFIG.DEFAULTS.MODEL,
      dimension: EMBEDDING_CONFIG.DEFAULTS.DIMENSIONS,
      modality: this.documentEmbeddingOptions.modality || EMBEDDING_CONFIG.DEFAULTS.MODALITY,
      inputType: this.documentInputType,
    });

    while (hasMore) {
      const query: Record<string, unknown> = this.buildPendingFilter();
      if (skippedIds.size > 0) {
        query._id = { $nin: Array.from(skippedIds, id => this.toMongoId(id)) };
      }

      const pending = await Note.find(query)
        .select('_id userId title content contentText updatedAt')
        .limit(batchSize);

      if (pending.length === 0) {
        hasMore = false;
        if (batchIndex === 1) {
          logger.info('✅ 所有笔记都已有向量，无需处理');
        }
        break;
      }

      logger.info(`📦 [Batch ${batchIndex}] 开始处理 ${pending.length} 条笔记...`);
      const result = await this.generateForNotes(pending as unknown as EmbeddingNote[]);

      totalProcessed += result.processedCount;
      totalSuccess += result.successCount;
      if (result.failures) allFailures.push(...result.failures);
      if (result.failures) {
        for (const failure of result.failures) {
          skippedIds.add(failure.noteId);
        }
      }
      if (result.successCount === 0) {
        for (const note of pending) {
          skippedIds.add(note._id.toString());
        }
        logger.warn(`⚠️ [Batch ${batchIndex}] 本轮没有成功写入 embedding，已跳过该批次避免死循环`);
      }

      logger.info(`✅ [Batch ${batchIndex}] 处理完成: ${result.successCount}/${result.processedCount}`);
      batchIndex++;

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return {
      processedCount: totalProcessed,
      successCount: totalSuccess,
      failureCount: allFailures.length,
      failures: allFailures.length > 0 ? allFailures : undefined,
    };
  }
}

export const noteEmbeddingService = new NoteEmbeddingService();

/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
import { Note } from '../models/Note';
import { generateQwenEmbedding, generateQwenEmbeddingBatch } from '../utils/embedding';
import { logger } from '../utils/logger';

export interface EmbeddingStats {
  totalNotes: number;
  notesWithEmbedding: number;
  notesWithoutEmbedding: number;
  embeddingCoverage: number;
  pendingNotes: string[];
}

export interface MaintenanceResult {
  processedCount: number;
  successCount: number;
  failureCount: number;
  failures?: Array<{
    noteId: string;
    error: string;
  }>;
}

export async function generateNoteEmbedding(noteId: string): Promise<void> {
  try {
    const note = await Note.findById(noteId);
    if (!note) {
      logger.error(`❌ 笔记不存在: ${noteId}`);
      return;
    }

    if (note.embedding && note.embedding.length > 0) {
      logger.info(`⏭️ 笔记已有向量，跳过: ${noteId}`);
      return;
    }

    const textToEmbed = `${note.title || ''} ${note.content}`.trim();
    const embedding = await generateQwenEmbedding(textToEmbed, 1024);

    if (embedding.length > 0) {
      await Note.findByIdAndUpdate(noteId, { embedding });
      logger.info(`✅ 成功为笔记生成向量: ${noteId}`);
    } else {
      logger.error(`❌ 向量生成失败: ${noteId}`);
    }
  } catch (error: unknown) {
    logger.error(`❌ 笔记向量化处理失败 ${noteId}:`, (error as Error).message || error);
  }
}

export async function batchGenerateUserNoteEmbeddings(userId: string): Promise<void> {
  try {
    const notesWithoutEmbedding = await Note.find({
      userId,
      $or: [
        { embedding: { $exists: false } },
        { embedding: { $size: 0 } },
        { embedding: null }
      ]
    }).select('_id title content');

    if (notesWithoutEmbedding.length === 0) {
      logger.info(`✅ 用户 ${userId} 的所有笔记都已有向量`);
      return;
    }

    logger.info(`🔄 开始为用户 ${userId} 的 ${notesWithoutEmbedding.length} 条笔记生成向量`);

    const textsToEmbed = notesWithoutEmbedding.map(note => 
      `${note.title || ''} ${note.content}`.trim()
    );

    const embeddings = await generateQwenEmbeddingBatch(textsToEmbed, 1024);

    const updatePromises = notesWithoutEmbedding.map((note, index) => {
      if (embeddings[index] && embeddings[index].length > 0) {
        return Note.findByIdAndUpdate(note._id, { embedding: embeddings[index] });
      }
      return Promise.resolve();
    });

    await Promise.all(updatePromises);
    
    const successCount = embeddings.filter(emb => emb.length > 0).length;
    logger.info(`✅ 成功为用户 ${userId} 的 ${successCount}/${notesWithoutEmbedding.length} 条笔记生成向量`);
    
  } catch (error: unknown) {
    logger.error(`❌ 批量笔记向量化失败 ${userId}:`, (error as Error).message || error);
  }
}

export async function maintainAllNoteEmbeddings(): Promise<MaintenanceResult> {
  try {
    const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || '50');
    const maxRetries = parseInt(process.env.EMBEDDING_MAX_RETRIES || '3');
    
    let totalProcessed = 0;
    let totalSuccess = 0;
    const allFailures: Array<{ noteId: string; error: string }> = [];
    let hasMore = true;
    let batchIndex = 1;

    logger.info(`🚀 开始全量修复任务 (Batch Size: ${batchSize})`);

    while (hasMore) {
      // 获取当前批次的待处理笔记
      const notesWithoutEmbedding = await Note.find({
        $or: [
          { embedding: { $exists: false } },
          { embedding: { $size: 0 } },
          { embedding: null }
        ]
      }).select('_id title content').limit(batchSize);

      if (notesWithoutEmbedding.length === 0) {
        hasMore = false;
        if (batchIndex === 1) {
            logger.info('✅ 所有笔记都已有向量，无需处理');
        }
        break;
      }

      logger.info(`\n📦 [Batch ${batchIndex}] 开始处理 ${notesWithoutEmbedding.length} 条笔记...`);

      let retryCount = 0;
      let batchSuccess = false;
      
      const textsToEmbed = notesWithoutEmbedding.map(note => 
        `${note.title || ''} ${note.content}`.trim()
      );

      while (retryCount < maxRetries && !batchSuccess) {
        try {
          const embeddings = await generateQwenEmbeddingBatch(textsToEmbed, 1024);
          
          const updatePromises = notesWithoutEmbedding.map((note, index) => {
            if (embeddings[index] && embeddings[index].length > 0) {
              return Note.findByIdAndUpdate(note._id, { embedding: embeddings[index] });
            }
            return Promise.resolve();
          });

          await Promise.all(updatePromises);
          
          const batchSuccessCount = embeddings.filter(emb => emb.length > 0).length;
          totalSuccess += batchSuccessCount;
          totalProcessed += notesWithoutEmbedding.length;
          batchSuccess = true;
          
          logger.info(`✅ [Batch ${batchIndex}] 处理成功: ${batchSuccessCount}/${notesWithoutEmbedding.length}`);
          
        } catch (error: unknown) {
          retryCount++;
          logger.warn(`⚠️ [Batch ${batchIndex}] 第 ${retryCount} 次重试失败:`, (error as Error).message);
          
          if (retryCount >= maxRetries) {
            // 记录失败的笔记
            notesWithoutEmbedding.forEach(note => {
              allFailures.push({
                noteId: note._id.toString(),
                error: (error as Error).message || '未知错误'
              });
            });
            totalProcessed += notesWithoutEmbedding.length; // 即使失败也算处理过（尝试过）
          } else {
            // 等待一段时间后重试
            await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
          }
        }
      }

      batchIndex++;
      
      // 批次间短暂休息，避免触发限流
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const result: MaintenanceResult = {
      processedCount: totalProcessed,
      successCount: totalSuccess,
      failureCount: allFailures.length,
      failures: allFailures.length > 0 ? allFailures : undefined
    };

    return result;
    
  } catch (error: unknown) {
    logger.error('❌ 维护任务执行失败:', (error as Error).message || error);
    throw error;
  }
}

export async function getEmbeddingStats(): Promise<EmbeddingStats> {
  try {
    const totalNotes = await Note.countDocuments();
    const notesWithEmbedding = await Note.countDocuments({
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    });
    const notesWithoutEmbedding = totalNotes - notesWithEmbedding;
    const coverage = totalNotes > 0 ? (notesWithEmbedding / totalNotes) * 100 : 0;
    const embeddingCoverage = Math.round(coverage * 100) / 100;

    // 获取待处理笔记的ID列表（限制数量避免内存问题）
    const pendingNotes = await Note.find({
      $or: [
        { embedding: { $exists: false } },
        { embedding: { $size: 0 } },
        { embedding: null }
      ]
    }).select('_id').limit(100);

    const result: EmbeddingStats = {
      totalNotes,
      notesWithEmbedding,
      notesWithoutEmbedding,
      embeddingCoverage,
      pendingNotes: pendingNotes.map(note => note._id.toString())
    };
    
    return result;
  } catch (error: unknown) {
    logger.error('❌ 获取向量化统计失败:', (error as Error).message || error);
    const errorResult: EmbeddingStats = {
      totalNotes: 0,
      notesWithEmbedding: 0,
      notesWithoutEmbedding: 0,
      embeddingCoverage: 0,
      pendingNotes: []
    };
    return errorResult;
  }
}
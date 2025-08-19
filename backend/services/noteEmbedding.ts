import { Note } from '../models/Note';
import { generateQwenEmbedding, generateQwenEmbeddingBatch } from '../utils/embedding';

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
      console.error(`❌ 笔记不存在: ${noteId}`);
      return;
    }

    if (note.embedding && note.embedding.length > 0) {
      console.log(`⏭️ 笔记已有向量，跳过: ${noteId}`);
      return;
    }

    const textToEmbed = `${note.title || ''} ${note.content}`.trim();
    const embedding = await generateQwenEmbedding(textToEmbed, 1024);

    if (embedding.length > 0) {
      await Note.findByIdAndUpdate(noteId, { embedding });
      console.log(`✅ 成功为笔记生成向量: ${noteId}`);
    } else {
      console.error(`❌ 向量生成失败: ${noteId}`);
    }
  } catch (error: any) {
    console.error(`❌ 笔记向量化处理失败 ${noteId}:`, error.message || error);
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
      console.log(`✅ 用户 ${userId} 的所有笔记都已有向量`);
      return;
    }

    console.log(`🔄 开始为用户 ${userId} 的 ${notesWithoutEmbedding.length} 条笔记生成向量`);

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
    console.log(`✅ 成功为用户 ${userId} 的 ${successCount}/${notesWithoutEmbedding.length} 条笔记生成向量`);
    
  } catch (error: any) {
    console.error(`❌ 批量笔记向量化失败 ${userId}:`, error.message || error);
  }
}

export async function maintainAllNoteEmbeddings(): Promise<MaintenanceResult> {
  try {
    const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || '50');
    const maxRetries = parseInt(process.env.EMBEDDING_MAX_RETRIES || '3');
    
    // 获取所有没有embedding的笔记
    const notesWithoutEmbedding = await Note.find({
      $or: [
        { embedding: { $exists: false } },
        { embedding: { $size: 0 } },
        { embedding: null }
      ]
    }).select('_id title content').limit(batchSize);

    if (notesWithoutEmbedding.length === 0) {
      console.log('✅ 所有笔记都已有向量，无需处理');
      return {
        processedCount: 0,
        successCount: 0,
        failureCount: 0
      };
    }

    console.log(`🔄 开始处理 ${notesWithoutEmbedding.length} 条笔记的向量生成`);

    const failures: Array<{ noteId: string; error: string }> = [];
    let successCount = 0;

    // 处理当前批次的笔记
    const textsToEmbed = notesWithoutEmbedding.map(note => 
      `${note.title || ''} ${note.content}`.trim()
    );

    let retryCount = 0;
    let batchSuccess = false;

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
        successCount += batchSuccessCount;
        batchSuccess = true;
        
        console.log(`✅ 批次处理成功: ${batchSuccessCount}/${notesWithoutEmbedding.length}`);
        
      } catch (error: any) {
        retryCount++;
        console.warn(`⚠️ 第 ${retryCount} 次重试失败:`, error.message);
        
        if (retryCount >= maxRetries) {
          // 记录失败的笔记
          notesWithoutEmbedding.forEach(note => {
            failures.push({
              noteId: note._id.toString(),
              error: error.message || '未知错误'
            });
          });
        } else {
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
        }
      }
    }

    const result: MaintenanceResult = {
      processedCount: notesWithoutEmbedding.length,
      successCount,
      failureCount: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };

    return result;
    
  } catch (error: any) {
    console.error('❌ 维护任务执行失败:', error.message || error);
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
  } catch (error: any) {
    console.error('❌ 获取向量化统计失败:', error.message || error);
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
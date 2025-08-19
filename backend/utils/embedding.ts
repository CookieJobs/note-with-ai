// backend/utils/embedding.ts
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const QWEN_EMBEDDING_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';

// 计算两个向量的余弦相似度
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
  
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  
    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

// 获取与某个 embedding 最相似的笔记
export function findTopMatches<T extends { embedding: number[] }>(
  queryEmbedding: number[],
  items: T[],
  topK = 5,
  threshold = 0.3 // 降低默认阈值，更宽松的匹配
): { item: T; score: number }[] {
  const scored = items
    .map((item) => ({ item, score: cosineSimilarity(queryEmbedding, item.embedding) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

// 使用 Qwen text-embedding-v4 生成单个文本的向量
export async function generateQwenEmbedding(
  text: string, 
  dimensions: number = 1024
): Promise<number[]> {
  try {
    if (!DASHSCOPE_API_KEY) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    const response = await axios.post(
      QWEN_EMBEDDING_URL,
      {
        model: 'text-embedding-v4',
        input: text,
        dimensions,
        encoding_format: 'float'
      },
      {
        headers: {
          'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000 // 10秒超时
      }
    );

    const embedding = response.data.data[0].embedding;
    console.log(`✅ 成功生成 ${dimensions} 维向量，文本长度: ${text.length}`);
    return embedding;
  } catch (error: any) {
    console.error('❌ Qwen Embedding 生成失败:', error.message || error);
    return [];
  }
}

// 批量生成向量（提高效率）
export async function generateQwenEmbeddingBatch(
  texts: string[], 
  dimensions: number = 1024
): Promise<number[][]> {
  try {
    if (!DASHSCOPE_API_KEY) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    // Qwen 支持批量处理，最多10行
    const batchSize = 10;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      const response = await axios.post(
        QWEN_EMBEDDING_URL,
        {
          model: 'text-embedding-v4',
          input: batch,
          dimensions,
          encoding_format: 'float'
        },
        {
          headers: {
            'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000 // 批量处理延长超时
        }
      );

      const batchEmbeddings = response.data.data.map((item: any) => item.embedding);
      results.push(...batchEmbeddings);
      
      console.log(`✅ 批量生成向量 ${i + 1}-${Math.min(i + batchSize, texts.length)}/${texts.length}`);
      
      // 避免频率限制，批次间稍作延迟
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  } catch (error: any) {
    console.error('❌ Qwen Embedding 批量生成失败:', error.message || error);
    return [];
  }
}

// 向量缓存配置
const CACHE_MAX_SIZE = 1000; // 最大缓存条目数
const CACHE_TTL = 24 * 60 * 60 * 1000; // 缓存过期时间：24小时

interface CacheItem {
  embedding: number[];
  timestamp: number;
}

// 向量缓存
const embeddingCache = new Map<string, CacheItem>();

// 缓存清理函数
function cleanExpiredCache() {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, item] of embeddingCache.entries()) {
    if (now - item.timestamp > CACHE_TTL) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => embeddingCache.delete(key));
  
  if (expiredKeys.length > 0) {
    console.log(`🧹 清理了 ${expiredKeys.length} 个过期的缓存条目`);
  }
}

// 缓存大小管理
function manageCacheSize() {
  if (embeddingCache.size > CACHE_MAX_SIZE) {
    // 删除最旧的条目
    const entries = Array.from(embeddingCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toDelete = entries.slice(0, embeddingCache.size - CACHE_MAX_SIZE + 100); // 多删除一些，避免频繁清理
    toDelete.forEach(([key]) => embeddingCache.delete(key));
    
    console.log(`📦 缓存大小管理：删除了 ${toDelete.length} 个最旧的缓存条目`);
  }
}

export async function getCachedQwenEmbedding(
  text: string, 
  dimensions: number = 1024
): Promise<number[]> {
  const cacheKey = `qwen_${dimensions}_${hashText(text)}`;
  
  // 清理过期缓存
  cleanExpiredCache();
  
  // 检查内存缓存
  const cachedItem = embeddingCache.get(cacheKey);
  if (cachedItem) {
    console.log('🎯 命中向量缓存');
    return cachedItem.embedding;
  }
  
  // 生成新向量并缓存
  const embedding = await generateQwenEmbedding(text, dimensions);
  if (embedding.length > 0) {
    embeddingCache.set(cacheKey, {
      embedding,
      timestamp: Date.now()
    });
    
    // 管理缓存大小
    manageCacheSize();
  }
  
  return embedding;
}

// 简单的文本哈希函数
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  return hash.toString(36);
}

// 根据用户ID搜索相关笔记
export async function findRelatedNotes(
  searchText: string,
  userId: string,
  threshold: number = 0.3, // 降低默认阈值，更宽松的匹配
  limit: number = 3
): Promise<{ note: any; score: number; matchType: 'vector' | 'keyword' }[]> {
  try {
    const { Note } = await import('../models/Note');
    
    // 获取用户的所有笔记（包含embedding）
    const userNotes = await Note.find({ 
      userId, 
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    });

    if (userNotes.length === 0) {
      console.log('⚠️ 用户没有包含向量的笔记');
      return [];
    }

    // 生成搜索文本的向量
    const searchEmbedding = await getCachedQwenEmbedding(searchText, 1024);
    if (searchEmbedding.length === 0) {
      console.log('⚠️ 无法生成搜索文本的向量');
      return [];
    }

    // 计算相似度
    const matches = findTopMatches(searchEmbedding, userNotes, limit, threshold);
    
    return matches.map(({ item, score }) => ({
      note: item,
      score,
      matchType: 'vector' as const
    }));
    
  } catch (error: any) {
    console.error('❌ 搜索相关笔记失败:', error.message || error);
    return [];
  }
}

// 智能相关性检测（混合关键词和向量匹配）
export async function findRelatedNotesAdvanced(
  userMessage: string,
  aiResponse: string,
  userNotes: any[],
  options: {
    maxResults?: number;
    threshold?: number;
    dimensions?: number;
  } = {}
): Promise<{ note: any; score: number; matchType: 'vector' | 'keyword' }[]> {
  const { maxResults = 3, threshold = 0.3, dimensions = 1024 } = options; // 降低默认阈值
  
  try {
    // 1. 并行生成用户消息和AI回复的向量
    const [userEmbedding, aiEmbedding] = await Promise.all([
      getCachedQwenEmbedding(userMessage, dimensions),
      getCachedQwenEmbedding(aiResponse, dimensions)
    ]);

    // 2. 过滤有向量的笔记
    const notesWithEmbedding = userNotes.filter(note => 
      note.embedding && note.embedding.length > 0
    );

    if (notesWithEmbedding.length === 0) {
      console.log('⚠️ 没有找到包含向量的笔记');
      return [];
    }

    // 3. 计算向量相似度
    const userMatches = findTopMatches(userEmbedding, notesWithEmbedding, maxResults, threshold);
    const aiMatches = findTopMatches(aiEmbedding, notesWithEmbedding, maxResults, threshold);

    // 4. 合并结果并去重
    const allMatches = new Map<string, { note: any; score: number; matchType: 'vector' | 'keyword' }>();
    
    userMatches.forEach(({ item, score }) => {
      const noteId = item._id.toString();
      if (!allMatches.has(noteId) || allMatches.get(noteId)!.score < score) {
        allMatches.set(noteId, { note: item, score, matchType: 'vector' });
      }
    });
    
    aiMatches.forEach(({ item, score }) => {
      const noteId = item._id.toString();
      if (!allMatches.has(noteId) || allMatches.get(noteId)!.score < score) {
        allMatches.set(noteId, { note: item, score, matchType: 'vector' });
      }
    });

    // 5. 按相似度排序并返回
    const results = Array.from(allMatches.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    console.log(`🔍 找到 ${results.length} 条相关笔记`);
    return results;
    
  } catch (error: any) {
    console.error('❌ 相关笔记检测失败:', error.message || error);
    return [];
  }
}
  
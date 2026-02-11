/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/utils/embedding.ts
import axios from 'axios';
import dotenv from 'dotenv';
import { EMBEDDING_CONFIG, isMultimodalModel } from '../config/embedding';

dotenv.config();

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';

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

// 使用 Qwen 嵌入模型生成单个文本的向量
export async function generateQwenEmbedding(
  text: string, 
  dimensions: number = EMBEDDING_CONFIG.QWEN.DEFAULT_DIMENSIONS
): Promise<number[]> {
  try {
    if (!DASHSCOPE_API_KEY) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    const model = EMBEDDING_CONFIG.QWEN.MODEL;
    const isMultimodal = isMultimodalModel(model);
    const url = isMultimodal 
      ? EMBEDDING_CONFIG.QWEN.MULTIMODAL_ENDPOINT 
      : EMBEDDING_CONFIG.QWEN.TEXT_ENDPOINT;

    let requestBody: any;
    if (isMultimodal) {
      // 多模态模型请求格式 (DashScope 原生 API)
      requestBody = {
        model,
        input: {
          contents: [
            { text }
          ]
        },
        parameters: {
          dimension: dimensions
        }
      };
    } else {
      // 标准文本模型请求格式 (OpenAI 兼容)
      requestBody = {
        model,
        input: text,
        dimensions,
        encoding_format: 'float'
      };
    }

    const response = await axios.post(
      url,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000 // 10秒超时
      }
    );

    let embedding: number[];
    if (isMultimodal) {
      // 多模态模型响应格式
      embedding = response.data.output.embeddings[0].embedding;
    } else {
      // 标准文本模型响应格式
      embedding = response.data.data[0].embedding;
    }

    console.log(`✅ 成功生成 ${dimensions} 维向量，文本长度: ${text.length} (模型: ${model})`);
    return embedding;
  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.message || error;
    console.error(`❌ Qwen Embedding 生成失败 (${EMBEDDING_CONFIG.QWEN.MODEL}):`, errorMsg);
    return [];
  }
}

// 批量生成向量（提高效率）
export async function generateQwenEmbeddingBatch(
  texts: string[], 
  dimensions: number = EMBEDDING_CONFIG.QWEN.DEFAULT_DIMENSIONS
): Promise<number[][]> {
  try {
    if (!DASHSCOPE_API_KEY) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    const model = EMBEDDING_CONFIG.QWEN.MODEL;
    const isMultimodal = isMultimodalModel(model);
    const url = isMultimodal 
      ? EMBEDDING_CONFIG.QWEN.MULTIMODAL_ENDPOINT 
      : EMBEDDING_CONFIG.QWEN.TEXT_ENDPOINT;

    // Qwen 支持批量处理
    const batchSize = EMBEDDING_CONFIG.QWEN.MAX_BATCH_SIZE;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      let requestBody: any;
      if (isMultimodal) {
        requestBody = {
          model,
          input: {
            contents: batch.map(text => ({ text }))
          },
          parameters: {
            dimension: dimensions
          }
        };
      } else {
        requestBody = {
          model,
          input: batch,
          dimensions,
          encoding_format: 'float'
        };
      }

      const response = await axios.post(
        url,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000 // 批量处理延长超时
        }
      );

      let batchEmbeddings: number[][];
      if (isMultimodal) {
        batchEmbeddings = response.data.output.embeddings.map((item: any) => item.embedding);
      } else {
        batchEmbeddings = response.data.data.map((item: any) => item.embedding);
      }
      
      results.push(...batchEmbeddings);
      
      console.log(`✅ 批量生成向量 ${i + 1}-${Math.min(i + batchSize, texts.length)}/${texts.length} (模型: ${model})`);
      
      // 避免频率限制，批次间稍作延迟
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.message || error;
    console.error(`❌ Qwen Embedding 批量生成失败 (${EMBEDDING_CONFIG.QWEN.MODEL}):`, errorMsg);
    return [];
  }
}

// 向量缓存配置
const CACHE_MAX_SIZE = parseInt(process.env.EMBEDDING_CACHE_SIZE || '2000'); // 增加缓存大小
const CACHE_TTL = parseInt(process.env.EMBEDDING_CACHE_TTL || '7200000'); // 2小时
const CACHE_CLEANUP_INTERVAL = parseInt(process.env.CACHE_CLEANUP_INTERVAL || '1800000'); // 30分钟清理一次

interface CacheItem {
  embedding: number[];
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

// 缓存统计
interface CacheStats {
  hits: number;
  misses: number;
  totalRequests: number;
  hitRate: number;
  cacheSize: number;
}

let cacheStats: CacheStats = {
  hits: 0,
  misses: 0,
  totalRequests: 0,
  hitRate: 0,
  cacheSize: 0
};

// 向量缓存
const embeddingCache = new Map<string, CacheItem>();

// 定期清理过期缓存
setInterval(() => {
  cleanExpiredCache();
  console.log(`🧹 缓存清理完成，当前缓存条目: ${embeddingCache.size}`);
}, CACHE_CLEANUP_INTERVAL);

// 缓存清理函数
function cleanExpiredCache() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [key, item] of embeddingCache.entries()) {
    if (now - item.timestamp > CACHE_TTL) {
      embeddingCache.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🗑️ 清理了 ${cleanedCount} 个过期缓存条目`);
  }
  
  cacheStats.cacheSize = embeddingCache.size;
}

// 智能缓存大小管理 - 使用LRU策略
function manageCacheSize() {
  if (embeddingCache.size > CACHE_MAX_SIZE) {
    // 使用LRU策略删除最少使用的条目
    const entries = Array.from(embeddingCache.entries());
    entries.sort((a, b) => {
      // 优先删除访问次数少且时间久的条目
      const scoreA = a[1].accessCount / (Date.now() - a[1].lastAccessed + 1);
      const scoreB = b[1].accessCount / (Date.now() - b[1].lastAccessed + 1);
      return scoreA - scoreB;
    });
    
    const toDelete = Math.floor(CACHE_MAX_SIZE * 0.2); // 删除20%的条目
    const deletedEntries = entries.slice(0, toDelete);
    deletedEntries.forEach(([key]) => embeddingCache.delete(key));
    
    console.log(`📦 缓存大小管理: 删除了 ${toDelete} 个条目，当前大小: ${embeddingCache.size}`);
  }
  
  cacheStats.cacheSize = embeddingCache.size;
}

// 获取缓存统计信息
export function getCacheStats(): CacheStats {
  cacheStats.hitRate = cacheStats.totalRequests > 0 
    ? (cacheStats.hits / cacheStats.totalRequests) * 100 
    : 0;
  cacheStats.cacheSize = embeddingCache.size;
  return { ...cacheStats };
}

// 清理所有缓存
export function clearCache(): void {
  const previousSize = embeddingCache.size;
  embeddingCache.clear();
  
  // 重置统计信息
  cacheStats = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    hitRate: 0,
    cacheSize: 0
  };
  
  console.log(`🗑️ 手动清理了所有缓存，清理了 ${previousSize} 个条目`);
}

export async function getCachedQwenEmbedding(
  text: string, 
  dimensions: number = EMBEDDING_CONFIG.QWEN.DEFAULT_DIMENSIONS
): Promise<number[]> {
  const cacheKey = `qwen_${dimensions}_${hashText(text)}`;
  
  // 更新统计
  cacheStats.totalRequests++;
  
  // 检查内存缓存
  const cachedItem = embeddingCache.get(cacheKey);
  if (cachedItem) {
    // 更新访问信息
    cachedItem.accessCount++;
    cachedItem.lastAccessed = Date.now();
    
    cacheStats.hits++;
    console.log(`🎯 命中向量缓存 (命中率: ${((cacheStats.hits / cacheStats.totalRequests) * 100).toFixed(1)}%)`);
    return cachedItem.embedding;
  }
  
  // 缓存未命中
  cacheStats.misses++;
  
  // 生成新向量并缓存
  const embedding = await generateQwenEmbedding(text, dimensions);
  if (embedding.length > 0) {
    const now = Date.now();
    embeddingCache.set(cacheKey, {
      embedding,
      timestamp: now,
      accessCount: 1,
      lastAccessed: now
    });
    
    // 管理缓存大小
    manageCacheSize();
    
    console.log(`💾 新向量已缓存 (缓存大小: ${embeddingCache.size}/${CACHE_MAX_SIZE})`);
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
  threshold: number = EMBEDDING_CONFIG.SIMILARITY.RELEVANCE_THRESHOLD,
  limit: number = EMBEDDING_CONFIG.SIMILARITY.DEFAULT_TOP_K,
  excludeNoteId?: string
): Promise<{ note: any; score: number; matchType: 'vector' | 'keyword' }[]> {
  try {
    const { Note } = await import('../models/Note');
    
    // 获取用户的所有笔记（包含embedding）
    const query: any = { 
      userId, 
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    };
    
    if (excludeNoteId) {
      query._id = { $ne: excludeNoteId };
    }

    const userNotes = await Note.find(query);

    if (userNotes.length === 0) {
      console.log('⚠️ 用户没有包含向量的笔记');
      return [];
    }

    // 生成搜索文本的向量
    const searchEmbedding = await getCachedQwenEmbedding(searchText, EMBEDDING_CONFIG.QWEN.DEFAULT_DIMENSIONS);
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
  const { 
    maxResults = EMBEDDING_CONFIG.SIMILARITY.DEFAULT_TOP_K, 
    threshold = EMBEDDING_CONFIG.SIMILARITY.RELEVANCE_THRESHOLD, 
    dimensions = EMBEDDING_CONFIG.QWEN.DEFAULT_DIMENSIONS 
  } = options; 
  
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
  
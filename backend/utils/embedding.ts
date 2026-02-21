/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/utils/embedding.ts
import axios from 'axios';
import { EMBEDDING_CONFIG, isMultimodalModel } from '../config/embedding';
import { config } from '../config';

const DASHSCOPE_API_KEY = config.DASHSCOPE_API_KEY || '';

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
const CACHE_MAX_SIZE = config.EMBEDDING_CACHE_SIZE; // 增加缓存大小
const CACHE_TTL = config.EMBEDDING_CACHE_TTL; // 2小时
const CACHE_CLEANUP_INTERVAL = config.CACHE_CLEANUP_INTERVAL; // 30分钟清理一次

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

  
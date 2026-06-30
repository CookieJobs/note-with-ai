/*
Input: 文本列表与 provider/model/inputType/modality 等 embedding 请求参数
Output: 统一的单条、批量、metadata 构建与缓存 embedding 能力，并兼容旧 Qwen 调用入口
Pos: 后端工具模块
Note: 默认走 OpenRouter provider；缓存键按 provider/model/dimensions/inputType/modality 隔离
*/
import axios from 'axios';
import {
  EMBEDDING_CONFIG,
  EmbeddingInputType,
  EmbeddingModality,
  EmbeddingProviderName,
  getDefaultEmbeddingOptions,
  isMultimodalModel,
} from '../config/embedding';
import type { INoteEmbeddingMetadata } from '../types';
import { logger } from './logger';

export interface EmbeddingGenerationOptions {
  provider?: EmbeddingProviderName;
  model?: string;
  dimensions?: number;
  inputType?: EmbeddingInputType;
  modality?: EmbeddingModality;
}

export interface ResolvedEmbeddingOptions {
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
  inputType: EmbeddingInputType;
  modality: EmbeddingModality;
}

interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly maxBatchSize: number;
  generateEmbeddings(texts: string[], options: ResolvedEmbeddingOptions): Promise<number[][]>;
}

export function resolveEmbeddingOptions(options: EmbeddingGenerationOptions = {}): ResolvedEmbeddingOptions {
  const defaults = getDefaultEmbeddingOptions();

  return {
    provider: options.provider ?? defaults.provider,
    model: options.model ?? defaults.model,
    dimensions: options.dimensions ?? defaults.dimensions,
    inputType: options.inputType ?? defaults.documentInputType,
    modality: options.modality ?? defaults.modality,
  };
}

export function buildNoteEmbeddingMetadata(
  options: EmbeddingGenerationOptions = {},
  embedding: number[] = []
): INoteEmbeddingMetadata {
  const resolved = resolveEmbeddingOptions(options);

  return {
    provider: resolved.provider,
    model: resolved.model,
    dimension: embedding.length > 0 ? embedding.length : resolved.dimensions,
    modality: resolved.modality,
    updatedAt: new Date(),
    image: null,
  };
}

export function buildExpectedNoteEmbeddingMetadata(options: EmbeddingGenerationOptions = {}) {
  const resolved = resolveEmbeddingOptions(options);

  return {
    provider: resolved.provider,
    model: resolved.model,
    dimension: resolved.dimensions,
    modality: resolved.modality,
  };
}

export function buildNoteEmbeddingMetadataFilter(
  options: EmbeddingGenerationOptions = {},
  prefix: string = 'embeddingMetadata'
): Record<string, unknown> {
  const expected = buildExpectedNoteEmbeddingMetadata(options);

  return {
    [`${prefix}.provider`]: expected.provider,
    [`${prefix}.model`]: expected.model,
    [`${prefix}.dimension`]: expected.dimension,
    [`${prefix}.modality`]: expected.modality,
  };
}

function assertTextOnly(modality: EmbeddingModality) {
  if (modality !== 'text') {
    throw new Error(`当前版本仅支持文本 embedding，收到 modality=${modality}`);
  }
}

function extractEmbeddingsFromResponse(data: any): number[][] {
  if (Array.isArray(data?.data)) {
    return data.data
      .map((item: { embedding?: number[] }) => item?.embedding)
      .filter((embedding: number[] | undefined): embedding is number[] => Array.isArray(embedding));
  }

  if (Array.isArray(data?.output?.embeddings)) {
    return data.output.embeddings
      .map((item: { embedding?: number[] }) => item?.embedding)
      .filter((embedding: number[] | undefined): embedding is number[] => Array.isArray(embedding));
  }

  return [];
}

function extractErrorMessage(error: unknown): string {
  const responseMessage =
    (error as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error?.message
    || (error as { response?: { data?: { message?: string } } })?.response?.data?.message;

  return responseMessage || (error as Error)?.message || String(error);
}

const openRouterProvider: EmbeddingProvider = {
  name: 'openrouter',
  maxBatchSize: EMBEDDING_CONFIG.PROVIDERS.OPENROUTER.MAX_BATCH_SIZE,
  async generateEmbeddings(texts, options) {
    assertTextOnly(options.modality);

    const providerConfig = EMBEDDING_CONFIG.PROVIDERS.OPENROUTER;
    if (!providerConfig.API_KEY) {
      throw new Error('OPENROUTER_API_KEY 环境变量未设置');
    }

    const response = await axios.post(
      `${providerConfig.BASE_URL}${providerConfig.EMBEDDINGS_PATH}`,
      {
        model: options.model,
        input: texts.length === 1 ? texts[0] : texts,
        dimensions: options.dimensions,
        encoding_format: 'float',
        input_type: options.inputType,
      },
      {
        headers: {
          Authorization: `Bearer ${providerConfig.API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: providerConfig.TIMEOUT_MS,
      }
    );

    return extractEmbeddingsFromResponse(response.data);
  },
};

const dashScopeProvider: EmbeddingProvider = {
  name: 'dashscope',
  maxBatchSize: EMBEDDING_CONFIG.PROVIDERS.DASHSCOPE.MAX_BATCH_SIZE,
  async generateEmbeddings(texts, options) {
    assertTextOnly(options.modality);

    const providerConfig = EMBEDDING_CONFIG.PROVIDERS.DASHSCOPE;
    if (!providerConfig.API_KEY) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    const useMultimodalEndpoint = isMultimodalModel(options.model);
    const requestBody = useMultimodalEndpoint
      ? {
          model: options.model,
          input: {
            contents: texts.map((text) => ({ text })),
          },
          parameters: {
            dimension: options.dimensions,
          },
        }
      : {
          model: options.model,
          input: texts.length === 1 ? texts[0] : texts,
          dimensions: options.dimensions,
          encoding_format: 'float',
          input_type: options.inputType,
        };

    const response = await axios.post(
      useMultimodalEndpoint ? providerConfig.MULTIMODAL_ENDPOINT : providerConfig.TEXT_ENDPOINT,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${providerConfig.API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: providerConfig.TIMEOUT_MS,
      }
    );

    return extractEmbeddingsFromResponse(response.data);
  },
};

const providerRegistry: Record<EmbeddingProviderName, EmbeddingProvider> = {
  openrouter: openRouterProvider,
  dashscope: dashScopeProvider,
};

function getProvider(providerName: EmbeddingProviderName): EmbeddingProvider {
  const provider = providerRegistry[providerName];
  if (!provider) {
    throw new Error(`不支持的 embedding provider: ${providerName}`);
  }
  return provider;
}

async function generateEmbeddingsInternal(
  texts: string[],
  options: EmbeddingGenerationOptions = {}
): Promise<number[][]> {
  const normalizedTexts = texts.map((text) => String(text || '').trim()).filter(Boolean);
  if (normalizedTexts.length === 0) {
    return [];
  }

  const resolved = resolveEmbeddingOptions(options);
  const provider = getProvider(resolved.provider);
  const results: number[][] = [];

  try {
    for (let index = 0; index < normalizedTexts.length; index += provider.maxBatchSize) {
      const batch = normalizedTexts.slice(index, index + provider.maxBatchSize);
      const batchEmbeddings = await provider.generateEmbeddings(batch, resolved);
      results.push(...batchEmbeddings);

      logger.info(
        `✅ 批量生成向量 ${index + 1}-${Math.min(index + batch.length, normalizedTexts.length)}/${normalizedTexts.length} `
        + `(provider: ${resolved.provider}, model: ${resolved.model}, inputType: ${resolved.inputType})`
      );

      if (index + provider.maxBatchSize < normalizedTexts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  } catch (error: unknown) {
    logger.error(
      `❌ Embedding 生成失败 (provider: ${resolved.provider}, model: ${resolved.model}, inputType: ${resolved.inputType}):`,
      extractErrorMessage(error)
    );
    return [];
  }
}

export async function generateEmbedding(
  text: string,
  options: EmbeddingGenerationOptions = {}
): Promise<number[]> {
  const [embedding] = await generateEmbeddingsBatch([text], options);
  return embedding || [];
}

export async function generateEmbeddingsBatch(
  texts: string[],
  options: EmbeddingGenerationOptions = {}
): Promise<number[][]> {
  return generateEmbeddingsInternal(texts, options);
}

// 向量缓存配置
const CACHE_MAX_SIZE = EMBEDDING_CONFIG.CACHE.MAX_SIZE;
const CACHE_TTL = EMBEDDING_CONFIG.CACHE.TTL;
const CACHE_CLEANUP_INTERVAL = 30 * 60 * 1000;

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
  logger.info(`🧹 缓存清理完成，当前缓存条目: ${embeddingCache.size}`);
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
    logger.info(`🗑️ 清理了 ${cleanedCount} 个过期缓存条目`);
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
    
    logger.info(`📦 缓存大小管理: 删除了 ${toDelete} 个条目，当前大小: ${embeddingCache.size}`);
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
  
  logger.info(`🗑️ 手动清理了所有缓存，清理了 ${previousSize} 个条目`);
}

function buildCacheScope(options: ResolvedEmbeddingOptions): string {
  return [
    'v2',
    `provider=${options.provider}`,
    `model=${options.model}`,
    `dimensions=${options.dimensions}`,
    `inputType=${options.inputType}`,
    `modality=${options.modality}`,
  ].join('|');
}

function buildCacheKey(text: string, options: ResolvedEmbeddingOptions): string {
  return `${buildCacheScope(options)}|text=${hashText(text)}`;
}

export async function getCachedEmbedding(
  text: string,
  options: EmbeddingGenerationOptions = {}
): Promise<number[]> {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return [];
  }

  const resolvedOptions = resolveEmbeddingOptions(options);
  const cacheKey = buildCacheKey(normalizedText, resolvedOptions);
  
  // 更新统计
  cacheStats.totalRequests++;
  
  // 检查内存缓存
  const cachedItem = embeddingCache.get(cacheKey);
  if (cachedItem) {
    // 更新访问信息
    cachedItem.accessCount++;
    cachedItem.lastAccessed = Date.now();
    
    cacheStats.hits++;
    logger.info(`🎯 命中向量缓存 (命中率: ${((cacheStats.hits / cacheStats.totalRequests) * 100).toFixed(1)}%)`);
    return cachedItem.embedding;
  }
  
  // 缓存未命中
  cacheStats.misses++;
  
  // 生成新向量并缓存
  const embedding = await generateEmbedding(normalizedText, resolvedOptions);
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
    
    logger.info(`💾 新向量已缓存 (缓存大小: ${embeddingCache.size}/${CACHE_MAX_SIZE})`);
  }
  
  return embedding;
}

const LEGACY_QWEN_MODEL =
  EMBEDDING_CONFIG.DEFAULTS.PROVIDER === 'dashscope'
    ? EMBEDDING_CONFIG.DEFAULTS.MODEL
    : 'qwen3-vl-embedding';

/**
 * @deprecated 请改用 generateEmbedding，并显式传入 provider/model/inputType/modality。
 */
export async function generateQwenEmbedding(
  text: string,
  dimensions: number = EMBEDDING_CONFIG.DEFAULTS.DIMENSIONS
): Promise<number[]> {
  return generateEmbedding(text, {
    provider: 'dashscope',
    model: LEGACY_QWEN_MODEL,
    dimensions,
    modality: 'text',
  });
}

/**
 * @deprecated 请改用 generateEmbeddingsBatch，并显式传入 provider/model/inputType/modality。
 */
export async function generateQwenEmbeddingBatch(
  texts: string[],
  dimensions: number = EMBEDDING_CONFIG.DEFAULTS.DIMENSIONS
): Promise<number[][]> {
  return generateEmbeddingsBatch(texts, {
    provider: 'dashscope',
    model: LEGACY_QWEN_MODEL,
    dimensions,
    modality: 'text',
  });
}

/**
 * @deprecated 请改用 getCachedEmbedding，并显式传入 provider/model/inputType/modality。
 */
export async function getCachedQwenEmbedding(
  text: string,
  dimensions: number = EMBEDDING_CONFIG.DEFAULTS.DIMENSIONS
): Promise<number[]> {
  return getCachedEmbedding(text, {
    provider: 'dashscope',
    model: LEGACY_QWEN_MODEL,
    dimensions,
    modality: 'text',
  });
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

  

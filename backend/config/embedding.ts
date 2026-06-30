/*
Input: embedding 运行时环境变量与 provider 选择
Output: 统一的 embedding 默认配置、provider 配置与校验方法
Pos: 后端配置模块
Note: 支持 OpenRouter 默认 provider，并保留 DashScope 兼容配置
*/
import { config } from './index';

export type EmbeddingProviderName = 'openrouter' | 'dashscope';
export type EmbeddingInputType = 'search_query' | 'search_document' | string;
export type EmbeddingModality = 'text' | 'image' | 'image_text';

/**
 * Embedding 相关配置
 */
export const EMBEDDING_CONFIG = {
  // 定时任务配置
  CRON: {
    // 根据环境变量决定执行频率：测试模式每分钟执行，生产模式每天凌晨2点执行
    SCHEDULE: config.EMBEDDING_TEST_MODE ? '* * * * *' : '0 2 * * *',
    TIMEZONE: 'Asia/Shanghai',
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 2000,
  },

  // 批处理配置
  BATCH: {
    // 每次处理的笔记数量
    SIZE: 50,
    // 最大重试次数
    MAX_RETRIES: 3,
  },

  // 缓存配置
  CACHE: {
    // 最大缓存条目数
    MAX_SIZE: config.EMBEDDING_CACHE_SIZE,
    // 缓存过期时间（毫秒）
    TTL: config.EMBEDDING_CACHE_TTL,
  },

  DEFAULTS: {
    PROVIDER: config.EMBEDDING_PROVIDER as EmbeddingProviderName,
    MODEL: config.EMBEDDING_MODEL,
    DIMENSIONS: config.EMBEDDING_DIMENSION,
    MODALITY: config.EMBEDDING_MODALITY as EmbeddingModality,
    INPUT_TYPES: {
      QUERY: config.EMBEDDING_QUERY_INPUT_TYPE,
      DOCUMENT: config.EMBEDDING_DOCUMENT_INPUT_TYPE,
    },
  },

  PROVIDERS: {
    OPENROUTER: {
      NAME: 'openrouter' as const,
      BASE_URL: config.OPENROUTER_BASE_URL,
      EMBEDDINGS_PATH: '/embeddings',
      API_KEY: config.OPENROUTER_API_KEY || '',
      TIMEOUT_MS: 30000,
      MAX_BATCH_SIZE: 25,
    },
    DASHSCOPE: {
      NAME: 'dashscope' as const,
      API_KEY: config.DASHSCOPE_API_KEY || '',
      TEXT_ENDPOINT: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
      MULTIMODAL_ENDPOINT: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding',
      TIMEOUT_MS: 30000,
      MAX_BATCH_SIZE: 25,
    },
  },

  // 相似度配置
  SIMILARITY: {
    // 相关性阈值
    RELEVANCE_THRESHOLD: config.SIMILARITY_THRESHOLD,
    // 默认返回的相似笔记数量
    DEFAULT_TOP_K: config.MAX_RELATED_NOTES,
  },

  // 日志配置
  LOGGING: {
    // 是否启用详细日志
    VERBOSE: config.NODE_ENV === 'development',
    // 是否记录性能指标
    PERFORMANCE: true,
  }
};

/**
 * 判断是否为多模态嵌入模型
 */
export function isMultimodalModel(modelName: string): boolean {
  return modelName.includes('-vl-') || modelName.includes('vision');
}

export function getDefaultEmbeddingOptions() {
  return {
    provider: EMBEDDING_CONFIG.DEFAULTS.PROVIDER,
    model: EMBEDDING_CONFIG.DEFAULTS.MODEL,
    dimensions: EMBEDDING_CONFIG.DEFAULTS.DIMENSIONS,
    modality: EMBEDDING_CONFIG.DEFAULTS.MODALITY,
    queryInputType: EMBEDDING_CONFIG.DEFAULTS.INPUT_TYPES.QUERY,
    documentInputType: EMBEDDING_CONFIG.DEFAULTS.INPUT_TYPES.DOCUMENT,
  };
}

export function getProviderRuntimeConfig(provider: EmbeddingProviderName = EMBEDDING_CONFIG.DEFAULTS.PROVIDER) {
  return provider === 'dashscope'
    ? EMBEDDING_CONFIG.PROVIDERS.DASHSCOPE
    : EMBEDDING_CONFIG.PROVIDERS.OPENROUTER;
}

// 环境变量验证
export function validateEmbeddingConfig(provider: EmbeddingProviderName = EMBEDDING_CONFIG.DEFAULTS.PROVIDER) {
  const missing: string[] = [];
  const providerConfig = getProviderRuntimeConfig(provider);

  if (!process.env.MONGODB_URI && !config.MONGODB_URI) {
    missing.push('MONGODB_URI');
  }

  if (!providerConfig.API_KEY) {
    missing.push(provider === 'dashscope' ? 'DASHSCOPE_API_KEY' : 'OPENROUTER_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(`缺少必要的环境变量: ${missing.join(', ')}`);
  }
}

// 获取运行时配置
export function getRuntimeConfig() {
  return {
    ...EMBEDDING_CONFIG,
    // 可以根据环境变量覆盖配置
    BATCH: {
      ...EMBEDDING_CONFIG.BATCH,
      SIZE: Number(process.env.EMBEDDING_BATCH_SIZE) || EMBEDDING_CONFIG.BATCH.SIZE,
    },
    CACHE: {
      ...EMBEDDING_CONFIG.CACHE,
      MAX_SIZE: Number(process.env.EMBEDDING_CACHE_SIZE) || EMBEDDING_CONFIG.CACHE.MAX_SIZE,
    },
  };
}

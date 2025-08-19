/**
 * Embedding 相关配置
 */

export const EMBEDDING_CONFIG = {
  // 定时任务配置
  CRON: {
    // 根据环境变量决定执行频率：测试模式每分钟执行，生产模式每天凌晨2点执行
    SCHEDULE: process.env.EMBEDDING_TEST_MODE === 'true' ? '* * * * *' : '0 2 * * *',
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
    MAX_SIZE: 1000,
    // 缓存过期时间（毫秒）
    TTL: 24 * 60 * 60 * 1000, // 24小时
  },

  // Qwen API 配置
  QWEN: {
    // 默认向量维度
    DEFAULT_DIMENSIONS: 1024,
    // API 请求超时时间
    TIMEOUT_MS: 30000,
    // 批量处理最大文本数
    MAX_BATCH_SIZE: 25,
  },

  // 相似度配置
  SIMILARITY: {
    // 相关性阈值
    RELEVANCE_THRESHOLD: 0.7,
    // 默认返回的相似笔记数量
    DEFAULT_TOP_K: 5,
  },

  // 日志配置
  LOGGING: {
    // 是否启用详细日志
    VERBOSE: process.env.NODE_ENV === 'development',
    // 是否记录性能指标
    PERFORMANCE: true,
  }
};

// 环境变量验证
export function validateEmbeddingConfig() {
  const requiredEnvVars = ['DASHSCOPE_API_KEY', 'MONGODB_URI'];
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  
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
      SIZE: parseInt(process.env.EMBEDDING_BATCH_SIZE || '50'),
    },
    CACHE: {
      ...EMBEDDING_CONFIG.CACHE,
      MAX_SIZE: parseInt(process.env.EMBEDDING_CACHE_SIZE || '1000'),
    }
  };
}
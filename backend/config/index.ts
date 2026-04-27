import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from '../utils/logger';

dotenv.config();

const envSchema = z.object({
  // 数据库配置
  MONGODB_URI: z.string().url().default('mongodb://localhost:27017/note-with-ai'),

  // 服务器配置
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // JWT 配置
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // DeepSeek API 配置
  DEEPSEEK_API_KEY: z.string().optional(),

  // Qwen API 配置
  DASHSCOPE_API_KEY: z.string().optional(),

  // Redis 配置
  REDIS_URL: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),

  // 向量化配置
  EMBEDDING_MODEL: z.string().default('text-embedding-v4'),
  EMBEDDING_DIMENSION: z.coerce.number().default(1024),
  SIMILARITY_THRESHOLD: z.coerce.number().default(0.7),
  MAX_RELATED_NOTES: z.coerce.number().default(3),

  // Embedding定时任务配置
  EMBEDDING_TEST_MODE: z.string().default('false').transform((val) => val === 'true'),

  // 缓存配置
  EMBEDDING_CACHE_SIZE: z.coerce.number().default(2000),
  EMBEDDING_CACHE_TTL: z.coerce.number().default(7200000),
  CACHE_CLEANUP_INTERVAL: z.coerce.number().default(1800000),

  // 日志配置
  LOG_LEVEL: z.string().default('info'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  logger.error('❌ Invalid environment variables:', _env.error.format());
  throw new Error('Invalid environment variables');
}

export const config = _env.data;

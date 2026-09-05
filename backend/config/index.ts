import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  // 数据库配置
  MONGODB_URI: z.string().url().default('mongodb://localhost:27017/note-with-ai'),

  // 服务器配置
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // JWT 配置
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Admin JWT and TOTP encryption configuration
  ADMIN_JWT_SECRET: z.string().min(32),
  ADMIN_JWT_EXPIRES_IN: z.string().default('8h'),
  ADMIN_ENCRYPTION_KEY: z.string().refine((value) => {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === value;
  }, 'ADMIN_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key'),

  // DeepSeek API 配置
  DEEPSEEK_API_KEY: z.string().optional(),
  SEARCH_PROVIDER_URL: z.string().url().optional(),
  SEARCH_PROVIDER_API_KEY: z.string().min(1).optional(),

  // Legacy DashScope API 配置
  DASHSCOPE_API_KEY: z.string().optional(),

  // OpenRouter Embedding 配置
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),

  // Redis 配置
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  REDIS_PASSWORD: z.string().optional(),

  // QQ 邮箱 SMTP 配置
  QQ_EMAIL_USER: z.string().min(1, "QQ_EMAIL_USER is required"),
  QQ_EMAIL_PASS: z.string().min(1, "QQ_EMAIL_PASS is required"),

  // 向量化配置
  EMBEDDING_PROVIDER: z.enum(['openrouter', 'dashscope']).default('openrouter'),
  EMBEDDING_MODEL: z.string().default('nvidia/llama-nemotron-embed-vl-1b-v2:free'),
  EMBEDDING_DIMENSION: z.coerce.number().default(2048),
  EMBEDDING_MODALITY: z.enum(['text', 'image', 'image_text']).default('text'),
  EMBEDDING_QUERY_INPUT_TYPE: z.string().default('search_query'),
  EMBEDDING_DOCUMENT_INPUT_TYPE: z.string().default('search_document'),
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

  // Optional AI price configuration (CNY per million tokens)
  AI_PRICING_EFFECTIVE_AT: z.string().datetime().optional(),
  DEEPSEEK_CHAT_INPUT_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
  DEEPSEEK_CHAT_OUTPUT_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
  OPENROUTER_EMBEDDING_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
  DASHSCOPE_EMBEDDING_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
});

type Environment = Record<string, string | undefined>;

const developmentDefaults = {
  JWT_SECRET: 'development-jwt-secret-not-for-production',
  ADMIN_JWT_SECRET: 'development-admin-jwt-secret-not-for-production',
  ADMIN_ENCRYPTION_KEY: Buffer.alloc(32, 0).toString('base64'),
  REDIS_URL: 'redis://localhost:6379',
  QQ_EMAIL_USER: 'development@example.invalid',
  QQ_EMAIL_PASS: 'development-only-password',
};

export function parseConfig(environment: Environment = process.env) {
  const nodeEnv = environment.NODE_ENV || 'development';
  const input = nodeEnv === 'production'
    ? environment
    : { ...developmentDefaults, ...environment };
  const result = envSchema.safeParse(input);

  if (!result.success) throw new Error('Invalid environment variables');
  if (result.data.NODE_ENV === 'production' && result.data.ADMIN_JWT_SECRET === result.data.JWT_SECRET) {
    throw new Error('ADMIN_JWT_SECRET must differ from JWT_SECRET');
  }
  return result.data;
}

export const config = parseConfig();

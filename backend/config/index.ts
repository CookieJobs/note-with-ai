import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// The opt-in evaluation process validates explicit inputs before importing this module.
if (process.env.NOTE_DISCOVERY_EVAL_PROCESS_ONLY !== 'true') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const discoveryPrice = z.string().trim().regex(/^(?:\d+(?:\.\d{1,12})?)?$/)
  .transform((value) => value === '' ? undefined : Number(value))
  .pipe(z.number().nonnegative().optional()).optional();
const discoveryCnyCap = z.string().trim().regex(/^(?:\d+(?:\.\d{1,6})?)?$/)
  .transform((value) => {
    if (value === '') return undefined;
    // Form the integer directly to avoid rounding CNY before converting to micros.
    const [whole, fraction = ''] = value.split('.');
    return Number(whole + fraction.padEnd(6, '0'));
  })
  .pipe(z.number().int().positive().optional()).optional();
const embeddingProvider = z.enum(['openrouter', 'dashscope']);
const pricedModel = z.string().trim().max(200).transform((value) => value || undefined).optional();

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
  // Local development convenience only. Production rejects this setting below.
  ADMIN_LOCAL_PASSWORD_ONLY: z.string().default('false').transform((value) => value === 'true'),

  // DeepSeek API 配置
  DEEPSEEK_API_KEY: z.string().optional(),

  // Tavily Search API 配置（仅后端）
  TAVILY_API_KEY: z.string().min(1).optional(),
  TAVILY_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(20_000).default(8_000),
  TAVILY_SEARCH_LANGUAGE: z.string().trim().min(2).max(20).default('zh'),
  INSPIRATION_AUTO_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  INSPIRATION_AUTO_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
  INSPIRATION_WORKER_POLL_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(60_000),

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
  EMBEDDING_PROVIDER: embeddingProvider.default('openrouter'),
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

  NOTE_DISCOVERY_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  NOTE_DISCOVERY_LOCAL_USER_ID: z.string().trim().regex(/^[a-f0-9]{24}$/i).transform((value) => value.toLowerCase()).optional(),
  NOTE_DISCOVERY_MODEL: z.string().trim().min(1).max(200).default('deepseek-flash'),
  // Discovery generation uses DeepSeek. Rates are only valid for the identified model.
  NOTE_DISCOVERY_PRICED_MODEL: pricedModel,
  NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION: discoveryPrice,
  NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION: discoveryPrice,
  NOTE_DISCOVERY_PRICED_EMBEDDING_PROVIDER: z.union([embeddingProvider, z.literal('')]).optional(),
  NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL: pricedModel,
  NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION: discoveryPrice,
  NOTE_DISCOVERY_USER_DAILY_CNY: discoveryCnyCap,
  NOTE_DISCOVERY_GLOBAL_DAILY_CNY: discoveryCnyCap,
  NOTE_DISCOVERY_RUN_RESERVATION_CNY: discoveryCnyCap,
  NOTE_DISCOVERY_MAX_MODEL_CALLS: z.coerce.number().int().min(1).max(3).default(3),
  NOTE_DISCOVERY_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(8).default(8),
  NOTE_DISCOVERY_MAX_NOTES_READ: z.coerce.number().int().min(1).max(12).default(12),
  NOTE_DISCOVERY_MAX_INPUT_TOKENS: z.coerce.number().int().min(1).max(24_000).default(24_000),
  NOTE_DISCOVERY_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(4_000).default(4_000),
  NOTE_DISCOVERY_TIMEOUT_MS: z.coerce.number().int().min(1).max(90_000).default(90_000),
  NOTE_DISCOVERY_AUTO_DEBOUNCE_MS: z.coerce.number().int().min(1).max(86_400_000).default(120_000),
  NOTE_DISCOVERY_AUTO_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(6),
  NOTE_DISCOVERY_AUTO_HOURLY_LIMIT: z.coerce.number().int().min(1).max(1000).default(2),
  NOTE_DISCOVERY_MANUAL_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(3),
  NOTE_DISCOVERY_MANUAL_COOLDOWN_MS: z.coerce.number().int().min(1).max(86_400_000).default(60_000),
  NOTE_DISCOVERY_DAILY_EXPOSURE_LIMIT: z.coerce.number().int().min(1).max(3).default(3),
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
  if (result.data.NODE_ENV !== 'development' && result.data.ADMIN_LOCAL_PASSWORD_ONLY) {
    throw new Error('ADMIN_LOCAL_PASSWORD_ONLY is only allowed in development');
  }
  if (result.data.NODE_ENV !== 'development' && result.data.NOTE_DISCOVERY_LOCAL_USER_ID) {
    throw new Error('NOTE_DISCOVERY_LOCAL_USER_ID is only allowed in development');
  }
  const {
    NOTE_DISCOVERY_USER_DAILY_CNY: NOTE_DISCOVERY_USER_DAILY_CNY_MICROS,
    NOTE_DISCOVERY_GLOBAL_DAILY_CNY: NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS,
    NOTE_DISCOVERY_RUN_RESERVATION_CNY: NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS,
    ...environmentConfig
  } = result.data;
  const NOTE_DISCOVERY_RUNNABLE = environmentConfig.NOTE_DISCOVERY_ENABLED
    && environmentConfig.NOTE_DISCOVERY_PRICED_MODEL === environmentConfig.NOTE_DISCOVERY_MODEL
    && environmentConfig.NOTE_DISCOVERY_PRICED_EMBEDDING_PROVIDER === environmentConfig.EMBEDDING_PROVIDER
    && environmentConfig.NOTE_DISCOVERY_PRICED_EMBEDDING_MODEL === environmentConfig.EMBEDDING_MODEL
    && [
      NOTE_DISCOVERY_USER_DAILY_CNY_MICROS,
      NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS,
      NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS,
      environmentConfig.NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION,
      environmentConfig.NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION,
      environmentConfig.NOTE_DISCOVERY_EMBEDDING_CNY_PER_MILLION,
    ].every((value) => value !== undefined);
  return {
    ...environmentConfig,
    NOTE_DISCOVERY_USER_DAILY_CNY_MICROS,
    NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS,
    NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS,
    NOTE_DISCOVERY_RUNNABLE,
  };
}

export const config = parseConfig();

export function isNoteDiscoveryAccountAllowed(userId: string, settings = config): boolean {
  return !settings.NOTE_DISCOVERY_LOCAL_USER_ID || settings.NOTE_DISCOVERY_LOCAL_USER_ID === userId.toLowerCase();
}

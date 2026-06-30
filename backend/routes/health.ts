/*
Input: 服务健康检查与 embedding 运行时统计请求
Output: 数据库状态、当前 embedding provider/model 配置与兼容覆盖率摘要
Pos: 后端 路由模块
Note: 健康检查显式暴露当前默认 embedding 配置和 API Key 配置状态，便于迁移巡检
*/
import express from 'express';
import mongoose from 'mongoose';
import { EMBEDDING_CONFIG } from '../config/embedding';
import { noteEmbeddingService } from '../services/noteEmbeddingService';
import { asyncHandler, ResponseHandler } from '../utils/errorHandler';

const router = express.Router();

/**
 * 健康检查端点
 */
router.get('/health', asyncHandler(async (req, res) => {
  const stats = await noteEmbeddingService.getGlobalEmbeddingStats();
  const isDev = process.env.NODE_ENV !== 'production';
  const activeProvider = EMBEDDING_CONFIG.DEFAULTS.PROVIDER;
  const activeProviderKeyConfigured = activeProvider === 'openrouter'
    ? Boolean(EMBEDDING_CONFIG.PROVIDERS.OPENROUTER.API_KEY)
    : Boolean(EMBEDDING_CONFIG.PROVIDERS.DASHSCOPE.API_KEY);
  const mongoInfo = isDev
    ? {
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        db: mongoose.connection.name,
      }
    : undefined;
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    embedding: {
      totalNotes: stats.totalNotes,
      notesWithEmbedding: stats.notesWithEmbedding,
      notesWithCurrentEmbedding: stats.notesWithCurrentEmbedding,
      notesWithOutdatedEmbedding: stats.notesWithOutdatedEmbedding,
      notesWithoutEmbedding: stats.notesWithoutEmbedding,
      coverage: Math.round(stats.embeddingCoverage),
      currentConfigCoverage: Math.round(stats.currentConfigCoverage),
      pendingCount: stats.pendingNotes.length,
    },
    config: {
      provider: activeProvider,
      model: EMBEDDING_CONFIG.DEFAULTS.MODEL,
      dimension: EMBEDDING_CONFIG.DEFAULTS.DIMENSIONS,
      modality: EMBEDDING_CONFIG.DEFAULTS.MODALITY,
      inputTypes: {
        query: EMBEDDING_CONFIG.DEFAULTS.INPUT_TYPES.QUERY,
        document: EMBEDDING_CONFIG.DEFAULTS.INPUT_TYPES.DOCUMENT,
      },
      batchSize: EMBEDDING_CONFIG.BATCH.SIZE,
      cacheMaxSize: EMBEDDING_CONFIG.CACHE.MAX_SIZE,
      cronSchedule: EMBEDDING_CONFIG.CRON.SCHEDULE,
    },
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasMongoUri: !!process.env.MONGODB_URI,
      activeProviderApiKeyConfigured: activeProviderKeyConfigured,
      apiKeys: {
        openrouterConfigured: Boolean(EMBEDDING_CONFIG.PROVIDERS.OPENROUTER.API_KEY),
        dashscopeConfigured: Boolean(EMBEDDING_CONFIG.PROVIDERS.DASHSCOPE.API_KEY),
      },
    },
    ...(mongoInfo ? { mongo: mongoInfo } : {})
  };

  return ResponseHandler.success(res, health);
}));

/**
 * Embedding 统计信息端点
 */
router.get('/embedding/stats', asyncHandler(async (req, res) => {
  const stats = await noteEmbeddingService.getGlobalEmbeddingStats();
  const responseData = {
    ...stats,
    timestamp: new Date().toISOString()
  };
  
  return ResponseHandler.success(res, responseData);
}));

export default router;

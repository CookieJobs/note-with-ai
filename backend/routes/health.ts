/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
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
      notesWithoutEmbedding: stats.notesWithoutEmbedding,
      coverage: Math.round(stats.embeddingCoverage)
    },
    config: {
      batchSize: EMBEDDING_CONFIG.BATCH.SIZE,
      cacheMaxSize: EMBEDDING_CONFIG.CACHE.MAX_SIZE,
      cronSchedule: EMBEDDING_CONFIG.CRON.SCHEDULE
    },
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasApiKey: !!process.env.DASHSCOPE_API_KEY,
      hasMongoUri: !!process.env.MONGODB_URI
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

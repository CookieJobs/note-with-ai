import express from 'express';
import { getEmbeddingStats } from '../services/noteEmbedding';
import { EMBEDDING_CONFIG } from '../config/embedding';
import { asyncHandler, ResponseHandler } from '../utils/errorHandler';

const router = express.Router();

/**
 * 健康检查端点
 */
router.get('/health', asyncHandler(async (req, res) => {
  const stats = await getEmbeddingStats();
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    embedding: {
      totalNotes: stats.totalNotes,
      notesWithEmbedding: stats.notesWithEmbedding,
      notesWithoutEmbedding: stats.notesWithoutEmbedding,
      coverage: stats.totalNotes > 0 ? 
        Math.round((stats.notesWithEmbedding / stats.totalNotes) * 100) : 0
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
    }
  };

  return ResponseHandler.success(res, health);
}));

/**
 * Embedding 统计信息端点
 */
router.get('/embedding/stats', asyncHandler(async (req, res) => {
  const stats = await getEmbeddingStats();
  const responseData = {
    ...stats,
    timestamp: new Date().toISOString()
  };
  
  return ResponseHandler.success(res, responseData);
}));

export default router;
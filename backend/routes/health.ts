import express from 'express';
import { getEmbeddingStats } from '../services/noteEmbedding';
import { EMBEDDING_CONFIG } from '../config/embedding';

const router = express.Router();

/**
 * 健康检查端点
 */
router.get('/health', async (req, res) => {
  try {
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

    res.json(health);
  } catch (error: any) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Embedding 统计信息端点
 */
router.get('/embedding/stats', async (req, res) => {
  try {
    const stats = await getEmbeddingStats();
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
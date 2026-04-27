/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/routes/performance.ts
import express, { Request, Response } from 'express';
import { PerformanceMonitor } from '../utils/performance';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';

const router = express.Router();
type PerformanceReport = ReturnType<typeof PerformanceMonitor.getSystemPerformanceReport>;

// 获取系统性能报告
router.get('/report', asyncHandler(async (req: Request, res: Response) => {
  const report: PerformanceReport = PerformanceMonitor.getSystemPerformanceReport();
  
  const responseData = {
    ...report,
    timestamp: new Date().toISOString(),
    summary: {
      cacheHitRate: `${report.cache.hitRate.toFixed(2)}%`,
      totalCacheRequests: report.cache.totalRequests,
      systemUptime: `${Math.floor(report.systemHealth.uptime / 3600)}h ${Math.floor((report.systemHealth.uptime % 3600) / 60)}m`,
      memoryUsageFormatted: {
        rss: `${Math.round(report.systemHealth.memoryUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(report.systemHealth.memoryUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(report.systemHealth.memoryUsage.heapTotal / 1024 / 1024)}MB`
      }
    }
  };
  
  ResponseHandler.success(res, responseData, '获取性能报告成功');
}));

// 获取特定操作的性能统计
router.get('/stats/:operationName', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { operationName } = req.params;
  const stats = PerformanceMonitor.getPerformanceStats(operationName);
  
  const responseData = {
    operationName,
    ...stats,
    averageDurationFormatted: `${stats.averageDuration.toFixed(2)}ms`,
    successRateFormatted: `${stats.successRate.toFixed(2)}%`
  };
  
  ResponseHandler.success(res, responseData, '获取操作统计成功');
}));

// 清理性能记录
router.post('/clear', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  PerformanceMonitor.clearMetrics();
  ResponseHandler.success(res, null, '性能记录已清理');
}));

// 性能测试端点
router.post('/test', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { testType = 'basic' } = req.body;
  const userId = req.user?.userId;
  
  if (!userId) {
    throw ErrorHandler.createAuthenticationError();
  }

    let testResults: Record<string, unknown> = {};

    if (testType === 'database') {
      // 数据库查询性能测试
      const { measureDatabaseQuery } = await import('../utils/performance');
      const { Note } = await import('../models/Note');
      
      testResults.noteQuery = await measureDatabaseQuery(
        'user_notes_query',
        () => Note.find({ userId }).limit(10),
        10
      );
      
      testResults.noteWithEmbeddingQuery = await measureDatabaseQuery(
        'user_notes_with_embedding_query',
        () => Note.find({ 
          userId, 
          embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
        }).limit(10),
        10
      );
    }

    if (testType === 'embedding') {
      // 向量计算性能测试
      const { measureEmbeddingOperation } = await import('../utils/performance');
      const { getCachedQwenEmbedding } = await import('../utils/embedding');
      
      const testText = '这是一个性能测试文本，用于测试向量计算的速度和缓存效果。';
      
      testResults.embeddingGeneration = await measureEmbeddingOperation(
        'test_embedding_generation',
        () => getCachedQwenEmbedding(testText, 1024),
        testText.length
      );
      
      // 测试缓存命中
      testResults.embeddingCache = await measureEmbeddingOperation(
        'test_embedding_cache_hit',
        () => getCachedQwenEmbedding(testText, 1024),
        testText.length
      );
    }

  const responseData = {
    testType,
    results: testResults,
    timestamp: new Date().toISOString()
  };
  
  ResponseHandler.success(res, responseData, '性能测试完成');
}));

export default router;

// backend/routes/cache.ts
import express from 'express';
import { getCacheStats } from '../utils/embedding';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';

const router = express.Router();

// 获取缓存统计信息
router.get('/stats', asyncHandler(async (req: any, res: any) => {
  const stats = getCacheStats();
  
  const responseData = {
    ...stats,
    hitRateFormatted: `${stats.hitRate.toFixed(2)}%`,
    cacheUtilization: `${stats.cacheSize}/2000`,
    utilizationPercentage: `${((stats.cacheSize / 2000) * 100).toFixed(1)}%`
  };
  
  ResponseHandler.success(res, responseData, '获取缓存统计成功');
}));

// 清理缓存（管理员功能）
router.post('/clear', authenticateToken, asyncHandler(async (req: any, res: any) => {
  // 这里可以添加管理员权限检查
  // 暂时允许所有认证用户清理缓存
  
  // 动态导入以避免循环依赖
  const { clearCache } = await import('../utils/embedding');
  
  if (clearCache) {
    await clearCache();
    ResponseHandler.success(res, null, '缓存已清理');
  } else {
    throw ErrorHandler.createInternalError('缓存清理功能未实现');
  }
}));

export default router;
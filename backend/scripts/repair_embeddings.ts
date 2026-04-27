/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/scripts/repair_embeddings.ts
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { maintainAllNoteEmbeddings, getEmbeddingStats } from '../services/noteEmbedding';
import { validateEmbeddingConfig } from '../config/embedding';
import { logger } from '../utils/logger';

// 加载环境变量
dotenv.config();

// 验证配置
try {
  validateEmbeddingConfig();
} catch (error: unknown) {
  logger.error('❌ 配置验证失败:', (error as Error).message);
  process.exit(1);
}

// 连接数据库
const connectDB = async () => {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ 数据库连接成功');
  } catch (error) {
    logger.error('❌ 数据库连接失败:', error);
    process.exit(1);
  }
};

// 执行embedding维护任务
const runEmbeddingMaintenance = async () => {
  const startTime = new Date();
  logger.info(`🕐 [${startTime.toISOString()}] 开始执行Embedding修复任务...`);
  
  try {
    // 获取任务前的统计信息
    const beforeStats = await getEmbeddingStats();
    logger.info('📊 任务前统计:', {
      totalNotes: beforeStats.totalNotes,
      embeddedNotes: beforeStats.notesWithEmbedding,
      coverage: `${beforeStats.embeddingCoverage}%`,
      pendingCount: beforeStats.pendingNotes.length
    });

    // 执行维护任务
    const result = await maintainAllNoteEmbeddings();
    
    // 获取任务后的统计信息
    const afterStats = await getEmbeddingStats();
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    logger.info('✅ Embedding修复任务完成:', {
      processedNotes: result.processedCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      duration: `${duration}秒`,
      finalCoverage: `${afterStats.embeddingCoverage}%`,
      remainingPending: afterStats.pendingNotes.length
    });

    // 如果有失败的记录，记录详细信息
    if (result.failures && result.failures.length > 0) {
      logger.warn('⚠️ 部分笔记处理失败:', result.failures.map(f => ({
        noteId: f.noteId,
        error: f.error
      })));
    }

    // 记录成功统计
    if (result.successCount > 0) {
      logger.info(`📊 成功修复 ${result.successCount} 个笔记的 Embedding`);
    } else if (result.processedCount === 0) {
      logger.info('✨ 没有发现需要修复的笔记');
    }

  } catch (error: unknown) {
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    logger.error(`❌ [${endTime.toISOString()}] 修复任务失败 (耗时${duration}秒):`, {
      message: (error as Error).message,
      stack: (error as Error).stack,
      name: (error as Error).name
    });
    process.exit(1);
  }
};

// 主执行函数
const main = async () => {
  logger.info('🔧 启动Embedding修复工具...');
  await connectDB();
  await runEmbeddingMaintenance();
  await mongoose.disconnect();
  logger.info('✅ 数据库连接已关闭，任务结束');
};

// 运行主函数
main().catch(error => {
  logger.error('❌ 脚本执行出错:', error);
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', async () => {
  logger.info('\n🛑 收到关闭信号，正在优雅关闭...');
  await mongoose.disconnect();
  logger.info('✅ 数据库连接已关闭');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('\n🛑 收到终止信号，正在优雅关闭...');
  await mongoose.disconnect();
  logger.info('✅ 数据库连接已关闭');
  process.exit(0);
});

// backend/scripts/embeddingCronJob.ts
const cron = require('node-cron');
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { maintainAllNoteEmbeddings, getEmbeddingStats } from '../services/noteEmbedding';
import { EMBEDDING_CONFIG, validateEmbeddingConfig, getRuntimeConfig } from '../config/embedding';

// 加载环境变量
dotenv.config();

// 验证配置
try {
  validateEmbeddingConfig();
} catch (error: any) {
  console.error('❌ 配置验证失败:', error.message);
  process.exit(1);
}

// 获取运行时配置
const config = getRuntimeConfig();

// 连接数据库
const connectDB = async () => {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ 数据库连接成功');
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    process.exit(1);
  }
};

// 执行embedding维护任务
const runEmbeddingMaintenance = async () => {
  const startTime = new Date();
  console.log(`🕐 [${startTime.toISOString()}] 开始执行每日embedding维护任务...`);
  
  try {
    // 获取任务前的统计信息
    const beforeStats = await getEmbeddingStats();
    console.log('📊 任务前统计:', {
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
    
    console.log('✅ embedding维护任务完成:', {
      processedNotes: result.processedCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      duration: `${duration}秒`,
      finalCoverage: `${afterStats.embeddingCoverage}%`,
      remainingPending: afterStats.pendingNotes.length
    });

    // 如果有失败的记录，记录详细信息
    if (result.failures && result.failures.length > 0) {
      console.warn('⚠️ 部分笔记处理失败:', result.failures.map(f => ({
        noteId: f.noteId,
        error: f.error
      })));
    }

    // 记录成功统计
    if (result.successCount > 0) {
      console.log(`📊 成功处理 ${result.successCount} 个笔记的 Embedding`);
    }

  } catch (error: any) {
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    console.error(`❌ [${endTime.toISOString()}] embedding维护任务失败 (耗时${duration}秒):`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // 可以在这里添加告警通知逻辑
    // await sendAlertNotification(error);
  }
};

// 手动执行任务（用于测试）
const runManualTask = async () => {
  console.log('🔧 手动执行embedding维护任务...');
  await connectDB();
  await runEmbeddingMaintenance();
  await mongoose.disconnect();
  console.log('🔚 手动任务执行完成，数据库连接已关闭');
};

// 启动定时任务
const startCronJob = async () => {
  await connectDB();
  
  // 使用配置文件中的定时配置
  const cronSchedule = config.CRON.SCHEDULE;
  
  console.log(`⏰ 定时任务已启动，执行时间: ${cronSchedule}`);
  console.log('📅 下次执行时间:', cron.validate(cronSchedule) ? '配置有效' : '配置无效');
  
  // 如果是测试模式，立即执行一次任务
  if (process.env.EMBEDDING_TEST_MODE === 'true') {
    console.log('🚀 测试模式：立即执行一次embedding维护任务...');
    await runEmbeddingMaintenance();
  }
  
  // 设置定时任务
  cron.schedule(cronSchedule, runEmbeddingMaintenance, {
    scheduled: true,
    timezone: config.CRON.TIMEZONE // 设置为中国时区
  });

  console.log('🚀 embedding定时任务服务已启动');
};

// 根据命令行参数决定执行方式
const args = process.argv.slice(2);
if (args.includes('--manual') || args.includes('-m')) {
  // 手动执行
  runManualTask().catch(console.error);
} else {
  // 启动定时任务
  startCronJob().catch(console.error);
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n🛑 收到关闭信号，正在优雅关闭...');
  await mongoose.disconnect();
  console.log('✅ 数据库连接已关闭');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 收到终止信号，正在优雅关闭...');
  await mongoose.disconnect();
  console.log('✅ 数据库连接已关闭');
  process.exit(0);
});
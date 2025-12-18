// backend/scripts/repair_embeddings.ts
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { maintainAllNoteEmbeddings, getEmbeddingStats } from '../services/noteEmbedding';
import { validateEmbeddingConfig } from '../config/embedding';

// 加载环境变量
dotenv.config();

// 验证配置
try {
  validateEmbeddingConfig();
} catch (error: any) {
  console.error('❌ 配置验证失败:', error.message);
  process.exit(1);
}

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
  console.log(`🕐 [${startTime.toISOString()}] 开始执行Embedding修复任务...`);
  
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
    
    console.log('✅ Embedding修复任务完成:', {
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
      console.log(`📊 成功修复 ${result.successCount} 个笔记的 Embedding`);
    } else if (result.processedCount === 0) {
      console.log('✨ 没有发现需要修复的笔记');
    }

  } catch (error: any) {
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    console.error(`❌ [${endTime.toISOString()}] 修复任务失败 (耗时${duration}秒):`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    process.exit(1);
  }
};

// 主执行函数
const main = async () => {
  console.log('🔧 启动Embedding修复工具...');
  await connectDB();
  await runEmbeddingMaintenance();
  await mongoose.disconnect();
  console.log('✅ 数据库连接已关闭，任务结束');
};

// 运行主函数
main().catch(error => {
  console.error('❌ 脚本执行出错:', error);
  process.exit(1);
});

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

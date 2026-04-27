/*
Input: 无
Output: 修复日志
Pos: 后端 脚本
Note: 用于批量修复缺失标题和关键词的笔记
*/
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Note } from '../models/Note';
import { summarizeNote } from '../services/deepseek';
import { logger } from '../utils/logger';

// 加载环境变量
dotenv.config();

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

// 辅助函数：延时
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 主逻辑
const runRepair = async () => {
  await connectDB();

  try {
    const BATCH_SIZE = 10; // AI生成较慢，且有并发限制，设置小一点
    let hasMore = true;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let batchIndex = 1;

    logger.info('🚀 开始修复缺失标题和关键词的笔记...');

    while (hasMore) {
      // 查找条件：标题为空/未命名，或者关键词为空
      const notes = await Note.find({
        $or: [
          { title: { $exists: false } },
          { title: '' },
          { title: '未命名笔记' }, // 之前可能的默认值
          { keywords: { $exists: false } },
          { keywords: { $size: 0 } }
        ]
      }).limit(BATCH_SIZE);

      if (notes.length === 0) {
        hasMore = false;
        if (batchIndex === 1) {
            logger.info('✅ 没有发现需要修复的笔记');
        }
        break;
      }

      logger.info(`\n📦 [Batch ${batchIndex}] 找到 ${notes.length} 条待处理笔记...`);
      
      let batchSuccess = 0;

      // 串行处理（避免触发 DeepSeek QPS 限制）
      for (const note of notes) {
        try {
          const content = (note as any).contentText || note.content || '';
          
          // 内容太短，跳过或简单处理
          if (!content || content.length < 5) {
            logger.info(`⚠️ 笔记 ${note._id} 内容过短，跳过`);
            continue;
          }

          logger.info(`🤖 正在生成摘要: ${note._id} (长度: ${content.length})`);
          
          const result = await summarizeNote(content);

          if (!result) {
            logger.info(`⚠️ 笔记 ${note._id} 摘要生成失败，跳过`);
            continue;
          }
          
          // 更新笔记
          if (result.title || result.keywords.length > 0) {
            const updates: Record<string, unknown> = {};
            // 只有当原标题缺失或为默认值时才更新
            if (!note.title || note.title === '未命名笔记' || note.title === '') {
                updates.title = result.title;
            }
            // 只有当原关键词为空时才更新
            if (!note.keywords || note.keywords.length === 0) {
                updates.keywords = result.keywords;
            }

            if (Object.keys(updates).length > 0) {
                await Note.updateOne({ _id: note._id }, { $set: updates });
                logger.info(`✅ 更新成功: ${result.title} [${result.keywords.join(', ')}]`);
                batchSuccess++;
            } else {
                logger.info(`⏭️ 无需更新: ${note._id}`);
            }
          }

          // 单条处理间隔，保护 API
          await sleep(500); 

        } catch (err) {
          logger.error(`❌ 处理笔记 ${note._id} 失败:`, err);
        }
      }

      totalProcessed += notes.length;
      totalUpdated += batchSuccess;
      batchIndex++;

      logger.info(`📊 批次完成。成功更新: ${batchSuccess}/${notes.length}`);
      
      // 批次间休息
      if (hasMore) {
        logger.info('💤 休息 2 秒...');
        await sleep(2000);
      }
    }

    logger.info('\n🎉 修复任务完成！');
    logger.info(`总处理: ${totalProcessed}`);
    logger.info(`总更新: ${totalUpdated}`);

  } catch (error) {
    logger.error('❌ 脚本执行出错:', error);
  } finally {
    await mongoose.disconnect();
    logger.info('👋 数据库连接已关闭');
  }
};

runRepair();

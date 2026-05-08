/*
Input: 无
Output: 推荐更新日志
Pos: 后端 脚本
Note: 用于批量更新 liujin 用户笔记的关联推荐
*/
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Note } from '../models/Note';
import User from '../models/User';
import { updateNoteRecommendations } from '../services/recommendService';
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

const TARGET_USERNAME = 'liujin';
const SLEEP_MS = 2000; // 每条间隔2秒

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const runUpdate = async () => {
  await connectDB();

  try {
    // 1. 查找用户
    const user = await User.findOne({ username: TARGET_USERNAME });
    if (!user) {
      logger.error(`❌ 用户 '${TARGET_USERNAME}' 不存在!`);
      process.exit(1);
    }
    logger.info(`✅ 找到用户: ${user.username} (${user._id})`);

    // 2. 获取所有笔记
    const notes = await Note.find({ userId: user._id }).select('_id title');
    logger.info(`🔍 找到 ${notes.length} 条笔记，准备更新关联推荐...`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const current = i + 1;
      
      process.stdout.write(`\n[${current}/${notes.length}] 处理笔记: ${note.title || note._id} ... `);

      try {
        const result = await updateNoteRecommendations(note._id.toString(), user._id.toString());

        const recCount = result.recommendations.length;
        if (recCount > 0) {
          logger.info(`✅ 成功 (推荐数: ${recCount}, 缓存命中: ${result.meta.cacheHits}, AI调用: ${result.meta.cacheMisses})`);
        } else {
          logger.info(`⚠️ 无推荐结果: ${result.message || '可能是样本太少或无匹配'}`);
        }
        successCount++;
      } catch (err: unknown) {
        logger.info(`❌ 失败: ${(err as Error).message}`);
        failCount++;
      }

      // 休息一下，保护 AI 服务
      if (i < notes.length - 1) {
        await sleep(SLEEP_MS);
      }
    }

    logger.info('\n🎉 推荐更新任务完成！');
    logger.info(`✅ 成功处理: ${successCount}`);
    logger.info(`❌ 失败: ${failCount}`);

  } catch (error) {
    logger.error('❌ 脚本执行出错:', error);
  } finally {
    await mongoose.disconnect();
    logger.info('👋 数据库连接已关闭');
  }
};

runUpdate();

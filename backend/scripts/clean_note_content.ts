/*
Input: 无
Output: 清洗日志
Pos: 后端 脚本
Note: 用于清洗 liujin 用户笔记中的 HTML 标签
*/
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Note } from '../models/Note';
import User from '../models/User';
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

const runClean = async () => {
  await connectDB();

  try {
    // 1. 查找用户
    const user = await User.findOne({ username: TARGET_USERNAME });
    if (!user) {
      logger.error(`❌ 用户 '${TARGET_USERNAME}' 不存在!`);
      process.exit(1);
    }
    logger.info(`✅ 找到用户: ${user.username} (${user._id})`);

    // 2. 查找包含 HTML 标签的笔记
    // 这里主要查找包含 <p> 的笔记，因为这是最主要的标签
    const notes = await Note.find({
      userId: user._id,
      content: { $regex: /<p>/ }
    });

    logger.info(`🔍 找到 ${notes.length} 条可能含有 HTML 标签的笔记`);

    let updatedCount = 0;

    for (const note of notes) {
      const originalContent = note.content || '';
      
      // 清洗逻辑
      // 1. </p><p> -> \n (保留段落结构)
      // 2. <br> -> \n
      // 3. 去除所有剩余的 HTML 标签
      // 4. 解码 HTML 实体 (可选，暂时简单处理)
      
      let cleanContent = originalContent
        .replace(/<\/p><p>/gi, '\n') // 替换段落连接处为换行
        .replace(/<br\s*\/?>/gi, '\n') // 替换 br 为换行
        .replace(/<\/?[^>]+(>|$)/g, '') // 去除所有 HTML 标签
        .trim(); // 去除首尾空白

      // 如果内容有变化，则更新
      if (cleanContent !== originalContent) {
        // 更新 content 和 contentText
        // 注意：我们把 content 也改成了纯文本，这样前端直接显示文本即可
        await Note.updateOne(
          { _id: note._id },
          { 
            $set: { 
              content: cleanContent,
              contentText: cleanContent,
              contentJson: null // 清空旧的富文本结构，避免冲突
            } 
          }
        );
        updatedCount++;
        if (updatedCount % 50 === 0) {
            process.stdout.write('.');
        }
      }
    }

    logger.info('\n🎉 清洗任务完成！');
    logger.info(`✅ 共更新: ${updatedCount} 条笔记`);

  } catch (error) {
    logger.error('❌ 脚本执行出错:', error);
  } finally {
    await mongoose.disconnect();
    logger.info('👋 数据库连接已关闭');
  }
};

runClean();

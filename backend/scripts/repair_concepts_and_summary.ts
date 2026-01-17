/*
Input: 无
Output: 修复日志
Pos: 后端 脚本
Note: 用于补全 liujin 用户笔记的 summary 和 concepts 字段
*/
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Note } from '../models/Note';
import User from '../models/User';
import { checkOrUpdateSummaryConcepts } from '../services/deepseek';

// 加载环境变量
dotenv.config();

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

const TARGET_USERNAME = 'liujin';
const SLEEP_MS = 1000; // 间隔1秒

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const runRepair = async () => {
  await connectDB();

  try {
    // 1. 查找用户
    const user = await User.findOne({ username: TARGET_USERNAME });
    if (!user) {
      console.error(`❌ 用户 '${TARGET_USERNAME}' 不存在!`);
      process.exit(1);
    }
    console.log(`✅ 找到用户: ${user.username} (${user._id})`);

    // 2. 查找需要修复的笔记
    // 条件：summary 为空 OR concepts 为空/空数组
    const notes = await Note.find({
      userId: user._id,
      $or: [
        { summary: { $exists: false } },
        { summary: '' },
        { concepts: { $exists: false } },
        { concepts: { $size: 0 } }
      ]
    });

    console.log(`🔍 找到 ${notes.length} 条需要补全 summary/concepts 的笔记`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const current = i + 1;
      
      const content = (note as any).contentText || note.content || '';
      if (!content || content.length < 5) {
        console.log(`[${current}/${notes.length}] ⚠️ 内容过短，跳过: ${note._id}`);
        continue;
      }

      process.stdout.write(`[${current}/${notes.length}] 处理: ${note.title || note._id} ... `);

      try {
        // 调用 AI 生成
        // 我们传入空的 oldSummary 和 oldConcepts，强制 AI 生成新的
        const result = await checkOrUpdateSummaryConcepts({
            text: content,
            oldSummary: '',
            oldConcepts: []
        });

        if (result.is_ok === false && (result.summary || result.concepts.length > 0)) {
            // 更新数据库
            await Note.updateOne(
                { _id: note._id },
                { 
                    $set: { 
                        summary: result.summary,
                        concepts: result.concepts
                    } 
                }
            );
            console.log(`✅ 成功 (Concepts: ${result.concepts.length})`);
            successCount++;
        } else {
            console.log(`⏭️ AI 未返回有效更新`);
        }

      } catch (err: any) {
        console.log(`❌ 失败: ${err.message}`);
        failCount++;
      }

      // 休息一下
      if (i < notes.length - 1) {
        await sleep(SLEEP_MS);
      }
    }

    console.log('\n🎉 字段补全任务完成！');
    console.log(`✅ 成功更新: ${successCount}`);
    console.log(`❌ 失败: ${failCount}`);

  } catch (error) {
    console.error('❌ 脚本执行出错:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 数据库连接已关闭');
  }
};

runRepair();

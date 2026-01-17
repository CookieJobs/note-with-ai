/*
Input: 无
Output: 清洗日志
Pos: 后端 脚本
Note: 用于清洗数据库冗余字段和修复数据一致性
*/
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Note } from '../models/Note';
import * as cheerio from 'cheerio';

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

const runClean = async () => {
  await connectDB();

  try {
    console.log('🚀 开始数据库字段清洗...');

    // 1. 删除冗余字段
    // ai_summary, entities, semantic_chunk, summary_embedding, title_embedding, relatedNotes
    const unsetResult = await Note.updateMany(
      {},
      {
        $unset: {
          ai_summary: "",
          entities: "",
          semantic_chunk: "",
          summary_embedding: "",
          title_embedding: "",
          relatedNotes: ""
        }
      }
    );
    console.log(`🗑️ 已清理冗余字段: 影响 ${unsetResult.modifiedCount} 条记录`);

    // 2. 修复 contentText 为空的情况
    const notesNeedText = await Note.find({
      $or: [
        { contentText: { $exists: false } },
        { contentText: "" },
        { contentText: null }
      ],
      content: { $ne: "" } // content 不为空
    });

    console.log(`📝 发现 ${notesNeedText.length} 条笔记需要生成 contentText`);
    
    let textFixedCount = 0;
    for (const note of notesNeedText) {
      if (note.content) {
        // 简单提取纯文本：加载 HTML -> text()
        const $ = cheerio.load(note.content);
        const plainText = $.root().text().trim();
        
        if (plainText) {
          await Note.updateOne({ _id: note._id }, { $set: { contentText: plainText } });
          textFixedCount++;
        }
      }
    }
    console.log(`✅ 已修复 contentText: ${textFixedCount} 条`);

    // 3. 规范化 contentJson
    // 将缺失该字段的记录设为 null
    const jsonResult = await Note.updateMany(
      { contentJson: { $exists: false } },
      { $set: { contentJson: null } }
    );
    console.log(`🔧 已规范化 contentJson (设为 null): 影响 ${jsonResult.modifiedCount} 条记录`);

    console.log('\n🎉 数据库清洗任务完成！');

  } catch (error) {
    console.error('❌ 脚本执行出错:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 数据库连接已关闭');
  }
};

runClean();

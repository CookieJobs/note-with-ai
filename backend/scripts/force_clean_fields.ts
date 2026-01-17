/*
Input: 无
Output: 强制清理日志
Pos: 后端 脚本
Note: 绕过 Mongoose Schema，直接使用原生驱动清理冗余字段
*/
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const runForceClean = async () => {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
  
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ 数据库连接成功');

    if (!mongoose.connection.db) {
      throw new Error('Database connection not established');
    }
    // 获取原生集合对象 (绕过 Mongoose Schema)
    const collection = mongoose.connection.db.collection('notes');

    // 1. 验证：查找一个包含冗余字段的文档看看
    const sample = await collection.findOne({ ai_summary: { $exists: true } });
    if (sample) {
      console.log('⚠️ 发现残留字段的文档 (ID: ' + sample._id + ')，字段列表:');
      console.log(Object.keys(sample).filter(k => 
        ['ai_summary', 'entities', 'semantic_chunk', 'summary_embedding', 'title_embedding', 'relatedNotes'].includes(k)
      ));
    } else {
      console.log('❓ 未找到包含 ai_summary 的文档，尝试检查 entities...');
      const sample2 = await collection.findOne({ entities: { $exists: true } });
      if (sample2) {
        console.log('⚠️ 发现残留字段 (entities) 的文档 (ID: ' + sample2._id + ')');
      }
    }

    console.log('\n🚀 开始强制清理...');

    // 2. 强制清理
    const result = await collection.updateMany(
      {}, // 匹配所有文档
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

    console.log(`✅ 清理命令执行完毕。`);
    console.log(`   匹配文档数: ${result.matchedCount}`);
    console.log(`   修改文档数: ${result.modifiedCount}`);

    // 3. 再次验证
    const checkAgain = await collection.findOne({ 
      $or: [
        { ai_summary: { $exists: true } },
        { entities: { $exists: true } },
        { relatedNotes: { $exists: true } }
      ]
    });

    if (checkAgain) {
      console.error('❌ 警告：依然发现残留字段！');
    } else {
      console.log('🎉 验证通过：所有冗余字段已消失。');
    }

  } catch (error) {
    console.error('❌ 脚本执行出错:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 数据库连接已关闭');
  }
};

runForceClean();

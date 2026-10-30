/**
 * 历史一次性迁移：2026-05-18 引入邮箱验证码注册时，为此前没有
 * isVerified 字段的存量用户补记验证状态。不是日常修复或账户验证入口。
 *
 * 本脚本保留旧执行行为：运行即连接数据库，并将所有缺失 isVerified
 * 的用户设为 true；没有 dry-run、创建日期限制或交互确认，不能区分
 * 旧用户与后来因异常缺失该字段的用户。请勿在日常维护中重复运行。
 *
 * 如确需为未迁移的历史环境执行，先备份并只读核对目标用户范围；
 * 显式指定 MONGODB_URI，核实 dotenv 按当前工作目录加载的配置。
 * 未显式指定时会回退到本机 note-with-ai 数据库，不能据此判断目标正确。
 * 本次文档补充不代表任一环境已执行过该迁移，也不应接入应用启动流程。
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const result = await mongoose.connection.db!
    .collection('users')
    .updateMany(
      { isVerified: { $exists: false } },
      { $set: { isVerified: true } }
    );

  console.log(`Migrated ${result.modifiedCount} existing users (isVerified: true)`);
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

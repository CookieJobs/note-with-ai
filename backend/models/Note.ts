/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/models/Note.ts
import mongoose from 'mongoose';

const NoteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    title: { type: String },
    keywords: [{ type: String }],
    embedding: [{ type: Number }], // 可选字段，可后续异步填充
  },
  { timestamps: true } // 自动添加 createdAt 和 updatedAt 字段
);

// 数据库索引优化
// 1. 用户ID索引 - 提升按用户查询笔记的性能
NoteSchema.index({ userId: 1 });

// 2. 复合索引 - 优化有向量的笔记查询
NoteSchema.index({ userId: 1, embedding: 1 });

// 3. 时间索引 - 提升按时间排序的查询性能
NoteSchema.index({ createdAt: -1 });

// 4. 文本索引 - 支持全文搜索
NoteSchema.index({ title: 'text', content: 'text' });

// 5. 关键词索引 - 提升关键词搜索性能
NoteSchema.index({ keywords: 1 });

// 防止模型重复注册（热更新或多次引入时）
export const Note = mongoose.models.Note || mongoose.model('Note', NoteSchema);

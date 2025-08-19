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

// 防止模型重复注册（热更新或多次引入时）
export const Note = mongoose.models.Note || mongoose.model('Note', NoteSchema);

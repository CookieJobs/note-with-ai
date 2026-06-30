/*
Input: 笔记持久化字段定义，包括富文本内容、embedding 向量与推荐缓存
Output: Note Mongoose Schema、索引与模型导出
Pos: 后端 数据模型模块
Note: embeddingMetadata 为文本向量保存 provider/model/dimension/modality，并为未来图片 embedding 预留 image 扩展位
*/
// backend/models/Note.ts
import mongoose from 'mongoose';

const EmbeddingMetadataSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true },
    dimension: { type: Number, required: true },
    modality: { type: String, enum: ['text', 'image', 'image_text'], required: true },
    updatedAt: { type: Date, required: true },
    image: {
      type: new mongoose.Schema(
        {
          assetIds: [{ type: String }],
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { _id: false }
);

const NoteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    // 富文本：TipTap/ProseMirror JSON（可选）
    contentJson: { type: mongoose.Schema.Types.Mixed, default: null },
    // 富文本派生：用于搜索/embedding 的纯文本（可选，建议与 content 保持一致）
    contentText: { type: String, default: '' },
    title: { type: String },
    // 语义摘要：用于联想/重排输入（可选，异步生成并缓存）
    summary: { type: String, default: '' },
    // 概念扩展缓存：用于弱关联召回（可选，异步生成并缓存）
    concepts: [{ type: String }],
    // 语义联想结果缓存（用于节省 LLM token 成本）
    recommendCache: { type: mongoose.Schema.Types.Mixed, default: null },
    keywords: [{ type: String }],
    embedding: [{ type: Number }], // 可选字段，可后续异步填充
    embeddingMetadata: { type: EmbeddingMetadataSchema, default: null },
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

// 4. 文本索引 - 支持全文搜索（富文本场景用 contentText）
NoteSchema.index({ title: 'text', summary: 'text', content: 'text', contentText: 'text' });

// 5. 关键词索引 - 提升关键词搜索性能
NoteSchema.index({ keywords: 1 });

// 防止模型重复注册（热更新或多次引入时）
export const Note = mongoose.models.Note || mongoose.model('Note', NoteSchema);

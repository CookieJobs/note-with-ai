/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/models/Chat.ts
import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
});

const ChatSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    messages: [MessageSchema],
    relatedNotes: [{
      noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
      title: String,
      content: String,
      score: Number,
      matchType: String,
      reason: String,
      createdAt: Date
    }],
  },
  { timestamps: true }
);

// 数据库索引优化
// 1. 用户ID索引 - 提升按用户查询聊天会话的性能
ChatSchema.index({ userId: 1 });

// 2. 复合索引 - 优化按用户和时间查询
ChatSchema.index({ userId: 1, updatedAt: -1 });

// 3. 时间索引 - 提升按时间排序的查询性能
ChatSchema.index({ createdAt: -1 });
ChatSchema.index({ updatedAt: -1 });

// 4. 标题文本索引 - 支持聊天标题搜索
ChatSchema.index({ title: 'text' });

// ✅ 正确导出 Chat 模型
const Chat = mongoose.model('Chat', ChatSchema);
export default Chat;

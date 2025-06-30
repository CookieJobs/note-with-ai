// backend/models/Chat.ts
import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
});

const ChatSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // 来自 localStorage 的 UUID
  title: { type: String, required: true },
  messages: [MessageSchema],
  createdAt: { type: Date, default: Date.now },
});

export const Chat = mongoose.model('Chat', ChatSchema);
